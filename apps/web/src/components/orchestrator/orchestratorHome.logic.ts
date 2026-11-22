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
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";
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
  "needs-you": msg("Needs you", { $context: "thread stage, the thread is waiting on the user" }),
  thinking: msg("Thinking", { $context: "thread stage" }),
  code: msg("Code", { $context: "thread stage, the agent is editing files" }),
  terminal: msg("Terminal", { $context: "thread stage, the agent is running a command" }),
  checks: msg("Checks", { $context: "thread stage, the agent is running tests or checks" }),
  ready: msg("Ready", { $context: "thread stage, the agent finished" }),
  failed: msg("Failed", { $context: "thread stage" }),
  quiet: msg("Quiet", { $context: "thread stage, nothing is happening" }),
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
export function quietLine(thread: EnvironmentThreadShell, resolve: MessageResolver = m): string {
  const link = thread.pullRequests.findLast((candidate) => candidate.snapshot !== null);
  const snapshot = link?.snapshot;
  if (link === undefined || snapshot == null) {
    return resolve(msg("Idle", { $context: "a thread that is doing nothing" }));
  }
  const values = { number: link.number, title: snapshot.title };
  if (snapshot.state === "merged") return resolve(msg("PR #{number} merged · {title}", values));
  if (snapshot.state === "closed") return resolve(msg("PR #{number} closed · {title}", values));
  if (snapshot.isDraft) return resolve(msg("PR #{number} draft · {title}", values));
  switch (snapshot.checksState) {
    case "passing":
      return resolve(msg("PR #{number} open, checks passing · {title}", values));
    case "failing":
      return resolve(msg("PR #{number} open, checks failing · {title}", values));
    case "pending":
      return resolve(msg("PR #{number} open, checks running · {title}", values));
    default:
      return resolve(msg("PR #{number} open · {title}", values));
  }
}

function isSameLocalDay(iso: string | null | undefined, nowMs: number): boolean {
  if (iso == null) return false;
  const time = Date.parse(iso);
  return !Number.isNaN(time) && new Date(time).toDateString() === new Date(nowMs).toDateString();
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
  resolve: MessageResolver = m,
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
          text:
            link.snapshot?.title === undefined
              ? resolve(msg("Merged its pull request"))
              : resolve(
                  msg("Merged {title}", {
                    title: link.snapshot.title,
                    $context: "a thread merged the pull request with this title",
                  }),
                ),
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
          ? resolve(msg("Run failed"))
          : run.status === "interrupted" || run.status === "cancelled"
            ? resolve(msg("Run stopped"))
            : resolve(msg("Finished its run")),
        at: run.completedAt,
      });
    } else if (run?.startedAt != null) {
      entries.push({
        key: `${key}:run`,
        thread,
        kind: "started",
        text: resolve(msg("Started working")),
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
  resolve: MessageResolver = m,
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
        return {
          stage: "code",
          line: resolve(msg("Editing {file}", { file: item.fileName.split("/").at(-1) ?? "" })),
        };
      case "reasoning":
      case "assistant_message": {
        const line = liveThoughtLine(lastLine(item.text));
        if (line.length === 0) continue;
        return { stage: "thinking", line };
      }
      case "file_search":
        return {
          stage: "thinking",
          line:
            item.pattern === undefined
              ? resolve(msg("Searching files"))
              : resolve(msg("Searching {pattern}", { pattern: item.pattern })),
        };
      case "web_search":
        return {
          stage: "thinking",
          line:
            item.patterns?.[0] === undefined
              ? resolve(msg("Searching the web"))
              : resolve(msg("Searching the web for {query}", { query: item.patterns[0] })),
        };
      case "todo_list": {
        const step = item.steps.find((candidate) => candidate.status === "running");
        if (step === undefined) continue;
        return { stage: "thinking", line: step.text };
      }
      case "subagent":
        return {
          stage: "thinking",
          line: resolve(
            msg("Subagent: {line}", {
              line: liveThoughtLine(firstLine(item.progress ?? item.prompt)),
            }),
          ),
        };
      case "dynamic_tool":
        if (item.toolName === null) continue;
        return {
          stage: "thinking",
          line: resolve(
            msg("Using {tool}", { tool: item.toolName, $context: "the agent is using this tool" }),
          ),
        };
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
const SHIP_UPDATE_PREFIX = "Ship update:";

/**
 * The message Ship sends the orchestrator. It stays English: it is an agent prompt, and its
 * opening words and the update lines it asks for are how the deploy queue reads the chat back.
 */
export function shipRequestText(thread: EnvironmentThreadShell): string {
  const link = formatThreadLink(
    { environmentId: thread.environmentId, threadId: thread.id },
    thread.title,
  );
  return [
    `${SHIP_REQUEST_PREFIX} merge and deploy ${link}.`,
    `Record each step in this chat on its own line, written as "${SHIP_UPDATE_PREFIX}" then the thread link then one of: committed, pending merge, merged, deploying, live, failed.`,
    "Report back here once it is live or if anything blocks it.",
  ].join(" ");
}

export type DeployStatus =
  | "requested"
  | "committed"
  | "pending"
  | "checks"
  | "blocked"
  | "draft"
  | "merged"
  | "deploying"
  | "live"
  | "failed";

export const DEPLOY_STATUS_LABEL: Record<DeployStatus, string> = {
  requested: msg("Ship requested", { $context: "the user asked for this work to be released" }),
  committed: msg("Committed", { $context: "deploy pipeline step, the work is committed" }),
  pending: msg("Pending merge", { $context: "deploy pipeline step" }),
  checks: msg("Checks running", { $context: "pull request status" }),
  blocked: msg("Blocked", { $context: "pull request status, failing checks or conflicts" }),
  draft: msg("Draft", { $context: "pull request state" }),
  merged: msg("Merged", { $context: "pull request state" }),
  deploying: msg("Deploying", { $context: "deploy pipeline step" }),
  live: msg("Live", { $context: "deploy pipeline step, the release is live" }),
  failed: msg("Failed", { $context: "deploy pipeline step" }),
};

/** A recorded step: a Ship request, or a "Ship update:" line someone wrote in the chat. */
export interface ShipEvent {
  readonly threadKey: string;
  readonly status: DeployStatus;
  readonly at: number;
}

const UPDATE_STATUS: ReadonlyArray<readonly [RegExp, DeployStatus]> = [
  [/\bpending merge\b/i, "pending"],
  [/\bcommitted\b/i, "committed"],
  [/\bmerged\b/i, "merged"],
  [/\bdeploying\b/i, "deploying"],
  [/\blive\b/i, "live"],
  [/\bfailed\b/i, "failed"],
];

/** Ship requests and updates recorded in the orchestrator's chat, oldest first. */
export function selectShipEvents(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  environmentId: EnvironmentId,
): readonly ShipEvent[] {
  const events: ShipEvent[] = [];
  for (const { item } of items) {
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    const at = DateTime.toEpochMillis(item.startedAt ?? item.updatedAt);
    if (item.type === "user_message" && item.text.startsWith(SHIP_REQUEST_PREFIX)) {
      for (const ref of threadLinkRefs(item.text, environmentId)) {
        events.push({ threadKey: scopedThreadKey(ref), status: "requested", at });
      }
      continue;
    }
    if (!item.text.includes(SHIP_UPDATE_PREFIX)) continue;
    for (const line of item.text.split("\n")) {
      const start = line.indexOf(SHIP_UPDATE_PREFIX);
      // Only a line that opens with the marker, after list or quote markup, is an update.
      if (start === -1 || /[^\s>*\-\d.]/.test(line.slice(0, start))) continue;
      const update = line.slice(start + SHIP_UPDATE_PREFIX.length);
      // The status is read from the words around the link, never from the thread's title.
      const words = update.replace(/\[[^\]]*\]\([^)]*\)|<[^>]*>/g, " ");
      const status = UPDATE_STATUS.find(([pattern]) => pattern.test(words))?.[1];
      if (status === undefined) continue;
      for (const ref of threadLinkRefs(update, environmentId)) {
        events.push({ threadKey: scopedThreadKey(ref), status, at });
      }
    }
  }
  return events;
}

export interface DeployQueueEntry {
  readonly thread: EnvironmentThreadShell;
  readonly status: DeployStatus;
  /** The pull request's number and title, when the thread has one. */
  readonly pullRequest: string | null;
  /** When it reached this status. */
  readonly at: number;
  /** When its first recorded step happened, for the total once it is live. */
  readonly startedAt: number;
}

const DEPLOY_ORDER: Record<DeployStatus, number> = {
  failed: 0,
  deploying: 1,
  requested: 2,
  pending: 3,
  checks: 4,
  blocked: 5,
  committed: 6,
  draft: 7,
  merged: 8,
  live: 9,
};

/**
 * Where each thread is on its way out: its pull request (open, or merged) and the steps recorded
 * in the orchestrator's chat, whichever is newest. Deploy steps exist only where someone recorded
 * them. Anything settled more than a day ago drops off.
 */
export function selectDeployQueue(
  threads: readonly EnvironmentThreadShell[],
  events: readonly ShipEvent[],
  nowMs: number,
): readonly DeployQueueEntry[] {
  const entries: DeployQueueEntry[] = [];
  for (const thread of threads) {
    if (!isHomeThread(thread)) continue;
    const key = homeThreadKey(thread);
    const link = thread.pullRequests.findLast((candidate) => candidate.snapshot !== null);
    const snapshot = link?.snapshot ?? null;
    const pullRequest =
      link === undefined || snapshot === null ? null : `#${link.number} ${snapshot.title}`;
    const steps = events.filter(
      (event) => event.threadKey === key && nowMs - event.at < QUIET_WINDOW_MS,
    );
    const mergedAt = snapshot?.mergedAt == null ? Number.NaN : Date.parse(snapshot.mergedAt);
    if (!Number.isNaN(mergedAt) && nowMs - mergedAt < QUIET_WINDOW_MS) {
      steps.push({ threadKey: key, status: "merged", at: mergedAt });
    }
    const latest = steps.reduce<ShipEvent | null>(
      (newest, step) => (newest === null || step.at >= newest.at ? step : newest),
      null,
    );
    if (latest !== null) {
      entries.push({
        thread,
        status: latest.status,
        pullRequest,
        at: latest.at,
        startedAt: Math.min(...steps.map((step) => step.at)),
      });
      continue;
    }
    if (snapshot === null || snapshot.state !== "open") continue;
    const status: DeployStatus = snapshot.isDraft
      ? "draft"
      : snapshot.checksState === "failing" || snapshot.mergeability === "conflicting"
        ? "blocked"
        : snapshot.checksState === "pending"
          ? "checks"
          : "pending";
    const at = Date.parse(snapshot.updatedAt ?? thread.updatedAt);
    entries.push({ thread, status, pullRequest, at, startedAt: at });
  }
  return entries.toSorted((a, b) => DEPLOY_ORDER[a.status] - DEPLOY_ORDER[b.status] || b.at - a.at);
}

/** Threads whose work went out today: a pull request merged, or a deploy recorded as live. */
export function selectShippedToday(
  threads: readonly EnvironmentThreadShell[],
  events: readonly ShipEvent[],
  nowMs: number,
): readonly EnvironmentThreadShell[] {
  const today = new Date(nowMs).toDateString();
  const live = new Set(
    events
      .filter((event) => event.status === "live" && new Date(event.at).toDateString() === today)
      .map((event) => event.threadKey),
  );
  return threads.filter(
    (thread) =>
      isHomeThread(thread) &&
      (live.has(homeThreadKey(thread)) ||
        thread.pullRequests.some((link) => isSameLocalDay(link.snapshot?.mergedAt, nowMs))),
  );
}

/** A row for any thread, for lists that are not the default one. */
export function homeThreadRow(thread: EnvironmentThreadShell): HomeThreadRow {
  return { thread, state: resolveHomeThreadState(thread) };
}
