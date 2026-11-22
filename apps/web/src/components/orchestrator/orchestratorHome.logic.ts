/* oxlint-disable t3code/no-untranslated-copy -- T3 Luke fork screen, English only; keeps the generated catalogs matching upstream */
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import {
  isListedThreadLineage,
  type EnvironmentId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { formatThreadLink, threadLinkRefs } from "@t3tools/shared/threadLinks";
import * as DateTime from "effect/DateTime";

import { hasUnseenCompletion, resolveSidebarRowStatus } from "../Sidebar.logic";

export type HomeStage =
  | "needs-you"
  | "thinking"
  | "code"
  | "terminal"
  | "checks"
  | "ready"
  | "failed"
  | "quiet";

export const HOME_STAGE_LABEL: Record<HomeStage, string> = {
  "needs-you": "Needs you",
  thinking: "Thinking",
  code: "Code",
  terminal: "Terminal",
  checks: "Checks",
  ready: "Ready",
  failed: "Failed",
  quiet: "Quiet",
};

/** What a row is, from the thread list alone; a busy row refines its stage from its latest item. */
export type HomeThreadState = "needs-you" | "busy" | "ready" | "failed" | "quiet";

export function homeThreadKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function resolveHomeThreadState(thread: EnvironmentThreadShell): HomeThreadState {
  switch (resolveSidebarRowStatus(thread)) {
    case "approval":
    case "input":
    case "request":
      return "needs-you";
    case "preparing":
    case "working":
      return "busy";
    case "waiting":
      // Waiting on a child thread is still this turn; an idle session is not.
      return thread.runtime?.status === "running" ? "busy" : "quiet";
    case "failed":
    case "limited":
      return "failed";
    case "ready":
      return hasUnseenCompletion(thread) ? "ready" : "quiet";
  }
}

function isHomeThread(thread: EnvironmentThreadShell): boolean {
  return (
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    thread.delegatedFrom === null &&
    isListedThreadLineage(thread.lineage)
  );
}

/**
 * The chosen thread; without one, the top pinned thread, then the newest thread that is named, or
 * sits in a project named, "orchestrator".
 */
export function resolveOrchestratorThread(
  threads: readonly EnvironmentThreadShell[],
  projects: ReadonlyArray<Pick<EnvironmentProject, "environmentId" | "id" | "title">>,
  chosenKey: string,
): EnvironmentThreadShell | null {
  const live = threads.filter(isHomeThread);
  const chosen = live.find((thread) => homeThreadKey(thread) === chosenKey);
  if (chosen !== undefined) return chosen;
  const pinned = live
    .filter((thread) => thread.pinnedAt !== null)
    .toSorted((a, b) =>
      (a.pinOrderKey ?? a.pinnedAt ?? "").localeCompare(b.pinOrderKey ?? b.pinnedAt ?? ""),
    );
  if (pinned[0] !== undefined) return pinned[0];
  const named = /orchestrator/i;
  const namedProjects = new Set(
    projects
      .filter((project) => named.test(project.title))
      .map((project) => `${project.environmentId}:${project.id}`),
  );
  return (
    live
      .filter(
        (thread) =>
          named.test(thread.title) ||
          namedProjects.has(`${thread.environmentId}:${thread.projectId}`),
      )
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

/** Threads the orchestrator setting offers: pinned ones, then the most recently used. */
export function selectOrchestratorCandidates(
  threads: readonly EnvironmentThreadShell[],
): readonly EnvironmentThreadShell[] {
  return threads
    .filter(isHomeThread)
    .toSorted(
      (a, b) =>
        Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 40);
}

const STATE_ORDER: Record<HomeThreadState, number> = {
  "needs-you": 0,
  busy: 1,
  failed: 2,
  ready: 3,
  quiet: 4,
};
const QUIET_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUIET_ROW_LIMIT = 6;

export interface HomeThreadRow {
  readonly thread: EnvironmentThreadShell;
  readonly state: HomeThreadState;
}

/** Threads worth a row: anything live, then what went quiet in the last day, newest first. */
export function selectHomeThreadRows(
  threads: readonly EnvironmentThreadShell[],
  orchestratorKey: string | null,
  nowMs: number,
): readonly HomeThreadRow[] {
  return threads
    .filter((thread) => isHomeThread(thread) && homeThreadKey(thread) !== orchestratorKey)
    .map((thread) => ({ thread, state: resolveHomeThreadState(thread) }))
    .filter(
      (row) => row.state !== "quiet" || nowMs - Date.parse(row.thread.updatedAt) < QUIET_WINDOW_MS,
    )
    .toSorted(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        b.thread.updatedAt.localeCompare(a.thread.updatedAt),
    )
    .filter((row, index, sorted) => {
      if (row.state !== "quiet") return true;
      const firstQuiet = sorted.findIndex((candidate) => candidate.state === "quiet");
      return index - firstQuiet < QUIET_ROW_LIMIT;
    });
}

/** A quiet row's line, from the thread list alone: its pull request, or that it is idle. */
export function quietLine(thread: EnvironmentThreadShell): string {
  const link = thread.pullRequests.findLast((candidate) => candidate.snapshot !== null);
  const snapshot = link?.snapshot;
  if (link === undefined || snapshot == null) return "Idle";
  const state = snapshot.isDraft && snapshot.state === "open" ? "draft" : snapshot.state;
  const checks =
    snapshot.state === "open" && snapshot.checksState != null
      ? ` · checks ${snapshot.checksState}`
      : "";
  return `PR #${link.number} ${state}${checks} · ${snapshot.title}`;
}

function isSameLocalDay(iso: string | null | undefined, nowMs: number): boolean {
  if (iso == null) return false;
  const time = Date.parse(iso);
  return !Number.isNaN(time) && new Date(time).toDateString() === new Date(nowMs).toDateString();
}

/** Pull requests linked to a thread that merged today, each counted once. */
export function countMergedToday(
  threads: readonly EnvironmentThreadShell[],
  nowMs: number,
): number {
  const merged = new Set<string>();
  for (const thread of threads) {
    for (const link of thread.pullRequests) {
      if (isSameLocalDay(link.snapshot?.mergedAt, nowMs)) merged.add(link.url);
    }
  }
  return merged.size;
}

export interface HomeActivityEntry {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly kind: "merged" | "finished" | "failed" | "started";
  readonly text: string;
  readonly at: string;
}

/** The latest things threads did, read from the thread list: merges, finished runs, starts. */
export function selectRecentActivity(
  threads: readonly EnvironmentThreadShell[],
  limit: number,
): readonly HomeActivityEntry[] {
  const entries: HomeActivityEntry[] = [];
  for (const thread of threads) {
    if (!isHomeThread(thread)) continue;
    const key = homeThreadKey(thread);
    for (const link of thread.pullRequests) {
      const mergedAt = link.snapshot?.mergedAt;
      if (mergedAt != null) {
        entries.push({
          key: `${key}:pr:${link.url}`,
          thread,
          kind: "merged",
          text: `Merged ${link.snapshot?.title ?? "its pull request"}`,
          at: mergedAt,
        });
      }
    }
    const run = thread.latestRun;
    if (run?.completedAt != null) {
      const failed = run.status === "failed";
      entries.push({
        key: `${key}:run`,
        thread,
        kind: failed ? "failed" : "finished",
        text: failed
          ? "Run failed"
          : run.status === "interrupted" || run.status === "cancelled"
            ? "Run stopped"
            : "Finished its run",
        at: run.completedAt,
      });
    } else if (run?.startedAt != null) {
      entries.push({
        key: `${key}:run`,
        thread,
        kind: "started",
        text: "Started working",
        at: run.startedAt,
      });
    }
  }
  return entries
    .filter((entry) => !Number.isNaN(Date.parse(entry.at)))
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

const CHECK_COMMAND = /\b(test|tests|vitest|jest|pytest|check|lint|typecheck|tsc|build)\b/;
const ACTIVITY_SCAN_LIMIT = 30;

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function lastLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .findLast((line) => line.length > 0) ?? ""
  );
}

export interface HomeActivity {
  readonly stage: Extract<HomeStage, "thinking" | "code" | "terminal" | "checks">;
  readonly line: string;
}

/** The stage and one line for a running thread, from the newest item that says something. */
export function describeLatestActivity(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): HomeActivity | null {
  const oldest = Math.max(0, items.length - ACTIVITY_SCAN_LIMIT);
  for (let index = items.length - 1; index >= oldest; index -= 1) {
    const item = items[index]?.item;
    if (item === undefined) continue;
    switch (item.type) {
      case "user_message":
        // Nothing newer than the prompt has said anything yet.
        return null;
      case "command_execution": {
        const command = firstLine(item.input);
        return { stage: CHECK_COMMAND.test(command) ? "checks" : "terminal", line: `$ ${command}` };
      }
      case "file_change":
        return { stage: "code", line: `Editing ${item.fileName.split("/").at(-1)}` };
      case "reasoning":
      case "assistant_message": {
        const line = liveThoughtLine(lastLine(item.text));
        if (line.length === 0) continue;
        return { stage: "thinking", line };
      }
      case "file_search":
        return { stage: "thinking", line: `Searching ${item.pattern ?? "files"}` };
      case "web_search":
        return { stage: "thinking", line: `Searching the web for ${item.patterns?.[0] ?? "…"}` };
      case "todo_list": {
        const step = item.steps.find((candidate) => candidate.status === "running");
        if (step === undefined) continue;
        return { stage: "thinking", line: step.text };
      }
      case "subagent":
        return {
          stage: "thinking",
          line: `Subagent: ${liveThoughtLine(firstLine(item.progress ?? item.prompt))}`,
        };
      case "dynamic_tool":
        if (item.toolName === null) continue;
        return { stage: "thinking", line: `Using ${item.toolName}` };
      default:
        continue;
    }
  }
  return null;
}

/** The opening line of the agent's last message, as a summary of a finished thread. */
export function describeLastReply(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]?.item;
    if (item?.type === "assistant_message") {
      const line = liveThoughtLine(firstLine(item.text));
      if (line.length > 0) return line;
    }
  }
  return null;
}

/** `m:ss`, or `h:mm:ss` past the hour. */
export function formatHomeTimer(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${String(minutes).padStart(2, "0")}:${seconds}`;
}

const SHIP_REQUEST_PREFIX = "Ship request:";

/** The message Ship sends the orchestrator. Its opening words are how the queue finds it again. */
export function shipRequestText(thread: EnvironmentThreadShell): string {
  const link = formatThreadLink(
    { environmentId: thread.environmentId, threadId: thread.id },
    thread.title,
  );
  return `${SHIP_REQUEST_PREFIX} merge and deploy ${link}, then report back here once it is live or if anything blocks it.`;
}

/** When each thread's ship was last asked for, by thread key, read from the orchestrator's chat. */
export function selectShipRequests(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  environmentId: EnvironmentId,
): ReadonlyMap<string, number> {
  const requests = new Map<string, number>();
  for (const { item } of items) {
    if (item.type !== "user_message" || !item.text.startsWith(SHIP_REQUEST_PREFIX)) continue;
    for (const ref of threadLinkRefs(item.text, environmentId)) {
      requests.set(scopedThreadKey(ref), DateTime.toEpochMillis(item.updatedAt));
    }
  }
  return requests;
}

export type ShipStatus = "requested" | "ready" | "checks" | "blocked" | "draft" | "merged";

export const SHIP_STATUS_LABEL: Record<ShipStatus, string> = {
  requested: "Ship requested",
  ready: "Ready to ship",
  checks: "Checks running",
  blocked: "Blocked",
  draft: "Draft",
  merged: "Merged",
};

export interface ShipQueueEntry {
  readonly thread: EnvironmentThreadShell;
  readonly status: ShipStatus;
  /** The pull request's number and title, when the thread has one. */
  readonly pullRequest: string | null;
  readonly at: string;
}

const SHIP_ORDER: Record<ShipStatus, number> = {
  requested: 0,
  ready: 1,
  checks: 2,
  blocked: 3,
  draft: 4,
  merged: 5,
};

/**
 * What can be known about shipping without deploy tracking: each thread's newest pull request
 * (open, or merged today) and the threads a ship was asked for. A merge settles a request.
 */
export function selectShipQueue(
  threads: readonly EnvironmentThreadShell[],
  requests: ReadonlyMap<string, number>,
  nowMs: number,
): readonly ShipQueueEntry[] {
  const entries: ShipQueueEntry[] = [];
  for (const thread of threads) {
    if (!isHomeThread(thread)) continue;
    const link = thread.pullRequests.findLast((candidate) => candidate.snapshot !== null);
    const snapshot = link?.snapshot ?? null;
    const pullRequest =
      link === undefined || snapshot === null ? null : `#${link.number} ${snapshot.title}`;
    const requestedAt = requests.get(homeThreadKey(thread));
    if (snapshot?.state === "merged") {
      if (!isSameLocalDay(snapshot.mergedAt, nowMs) || snapshot.mergedAt == null) continue;
      entries.push({ thread, status: "merged", pullRequest, at: snapshot.mergedAt });
      continue;
    }
    if (requestedAt !== undefined && nowMs - requestedAt < QUIET_WINDOW_MS) {
      entries.push({
        thread,
        status: "requested",
        pullRequest,
        at: new Date(requestedAt).toISOString(),
      });
      continue;
    }
    if (snapshot === null || snapshot.state !== "open") continue;
    const status: ShipStatus = snapshot.isDraft
      ? "draft"
      : snapshot.checksState === "failing" || snapshot.mergeability === "conflicting"
        ? "blocked"
        : snapshot.checksState === "pending"
          ? "checks"
          : "ready";
    entries.push({ thread, status, pullRequest, at: snapshot.updatedAt ?? thread.updatedAt });
  }
  return entries.toSorted(
    (a, b) => SHIP_ORDER[a.status] - SHIP_ORDER[b.status] || b.at.localeCompare(a.at),
  );
}
