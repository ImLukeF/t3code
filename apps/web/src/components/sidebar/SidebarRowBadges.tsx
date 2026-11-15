import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useThreadCheckpointSummaries, useThreadShell } from "~/state/entities";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";

/** No new output for this long reads as stalled. */
const STALLED_AFTER_MS = 5 * 60_000;
const STALLED_TICK_MS = 30_000;
/** Recent work worth comparing for overlapping files. */
const RECENT_CHECKPOINTS = 3;

interface RunningThread {
  readonly key: string;
  readonly title: string;
  /** Same environment and same working folder: the project root or one worktree. */
  readonly folderKey: string;
  readonly projectKey: string;
}

interface ClashState {
  readonly running: ReadonlyArray<RunningThread>;
  readonly filesByKey: ReadonlyMap<string, ReadonlySet<string>>;
}

const useClashStore = create<ClashState>(() => ({ running: [], filesByKey: new Map() }));

function threadKeyOf(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function isRunning(thread: EnvironmentThreadShell): boolean {
  return (
    thread.archivedAt === null && thread.deletedAt === null && threadRuntimeIsActive(thread.runtime)
  );
}

/** `folder` or `file`, the other thread's title, and the shared file; encoded so the selector stays stable. */
function resolveClash(state: ClashState, key: string): string | null {
  const self = state.running.find((thread) => thread.key === key);
  if (self === undefined) return null;
  const sameFolder = state.running.find(
    (thread) => thread.key !== key && thread.folderKey === self.folderKey,
  );
  if (sameFolder !== undefined) return JSON.stringify(["folder", sameFolder.title, null]);
  const mine = state.filesByKey.get(key);
  if (mine === undefined) return null;
  for (const other of state.running) {
    if (other.key === key || other.projectKey !== self.projectKey) continue;
    const theirs = state.filesByKey.get(other.key);
    if (theirs === undefined) continue;
    for (const file of mine) {
      if (theirs.has(file)) return JSON.stringify(["file", other.title, file]);
    }
  }
  return null;
}

/** Records the files one running thread changed recently. Mounting it subscribes to its detail. */
function RunningThreadFiles(props: { readonly thread: EnvironmentThreadShell }) {
  const key = threadKeyOf(props.thread);
  const checkpoints = useThreadCheckpointSummaries(
    scopeThreadRef(props.thread.environmentId, props.thread.id),
  );
  const files = checkpoints
    .slice(-RECENT_CHECKPOINTS)
    .flatMap((checkpoint) => checkpoint.files.map((file) => file.path))
    .toSorted();
  const filesKey = files.join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes this thread's recent files to the clash store while it runs
  useEffect(() => {
    useClashStore.setState((state) => ({
      filesByKey: new Map(state.filesByKey).set(key, new Set(filesKey.split("\n"))),
    }));
    return () =>
      useClashStore.setState((state) => {
        const next = new Map(state.filesByKey);
        next.delete(key);
        return { filesByKey: next };
      });
  }, [filesKey, key]);
  return null;
}

/** Tracks running threads so rows can flag two that share a folder or recently touched one file. */
export function SidebarClashTracker(props: {
  readonly threads: readonly EnvironmentThreadShell[];
}) {
  const running = props.threads.filter(isRunning);
  const runningInfo = running.map((thread): RunningThread => ({
    key: threadKeyOf(thread),
    title: thread.title,
    folderKey: `${thread.environmentId}|${thread.worktreePath ?? `root:${thread.projectId}`}`,
    projectKey: `${thread.environmentId}|${thread.projectId}`,
  }));
  const runningKey = JSON.stringify(runningInfo);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the running threads into the clash store that each row reads
  useEffect(() => {
    useClashStore.setState({ running: JSON.parse(runningKey) as ReadonlyArray<RunningThread> });
  }, [runningKey]);
  return running.map((thread) => <RunningThreadFiles key={threadKeyOf(thread)} thread={thread} />);
}

/** What this row shares with another running thread, if anything. */
function useThreadClash(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): {
  readonly kind: "folder" | "file";
  readonly otherTitle: string;
  readonly file: string | null;
} | null {
  const key = threadKeyOf(thread);
  const encoded = useClashStore((state) => resolveClash(state, key));
  if (encoded === null) return null;
  const [kind, otherTitle, file] = JSON.parse(encoded) as [
    "folder" | "file",
    string,
    string | null,
  ];
  return { kind, otherTitle, file };
}

/** Minutes since a running thread last produced output, once that passes the stalled threshold. */
function useStalledMinutes(thread: EnvironmentThreadShell): number | null {
  // The sidebar's shells are held still while streaming; the live shell moves with each event.
  const live = useThreadShell(scopeThreadRef(thread.environmentId, thread.id)) ?? thread;
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clock timer so a quiet thread turns stalled without new events
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), STALLED_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const lastActivity = Math.max(
    Date.parse(live.updatedAt) || 0,
    Date.parse(live.runtime?.updatedAt ?? "") || 0,
  );
  const quietMs = now - lastActivity;
  return lastActivity > 0 && quietMs >= STALLED_AFTER_MS ? Math.floor(quietMs / 60_000) : null;
}

function StalledBadge(props: { readonly thread: EnvironmentThreadShell }) {
  const minutes = useStalledMinutes(props.thread);
  if (minutes === null) return null;
  return (
    <span className="shrink-0 rounded-full bg-warning/16 px-1.5 text-2xs font-medium text-warning-foreground">
      Stalled {minutes}m
    </span>
  );
}

/** Stalled and clash badges for one sidebar row; empty for threads that aren't running. */
export function SidebarRowBadges(props: { readonly thread: EnvironmentThreadShell }) {
  const clash = useThreadClash(props.thread);
  const working = isRunning(props.thread) && resolveSidebarThreadStatus(props.thread) === "working";
  if (!working && clash === null) return null;
  return (
    <span data-row-badges="" className="flex shrink-0 items-center gap-1">
      {working ? <StalledBadge thread={props.thread} /> : null}
      {clash ? (
        <span className="shrink-0 rounded-full bg-error/16 px-1.5 text-2xs font-medium text-error-foreground">
          {clash.kind === "folder" ? "Same folder" : "Same file"}
        </span>
      ) : null}
    </span>
  );
}
