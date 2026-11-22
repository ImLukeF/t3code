/* oxlint-disable t3code/no-untranslated-copy -- T3 Luke fork screen, English only; keeps the generated catalogs matching upstream */
import { useAtomValue } from "@effect/atom-react";
import { toServerClock } from "@t3tools/client-runtime/clock";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveThreadWorkingStartedAt,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { BotIcon, CheckIcon, type LucideIcon, PlayIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ComposerHandleContext } from "~/composerHandleContext";
import { useNowSecond } from "~/hooks/useNowSecond";
import { useClientSettings } from "~/hooks/useSettings";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { cn } from "~/lib/utils";
import { deriveProviderEntriesByEnvironment } from "~/providerInstances";
import { useProjects, useThreadVisibleTurnItems, useVisibleThreadShells } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { environmentThreadDetails } from "~/state/threads";
import { buildThreadRouteParams } from "~/threadRoutes";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { RelativeTime } from "../RelativeTime";
import { NeedsYouRequest } from "../sidebar/SidebarNeedsYou";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import {
  countMergedToday,
  describeLastReply,
  describeLatestActivity,
  formatHomeTimer,
  HOME_STAGE_LABEL,
  homeThreadKey,
  resolveOrchestratorThread,
  selectHomeThreadRows,
  quietLine,
  selectRecentActivity,
  type HomeActivityEntry,
  type HomeStage,
  type HomeThreadRow,
} from "./orchestratorHome.logic";

const STAGE_PILL: Record<HomeStage, string> = {
  "needs-you": "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  thinking: "bg-violet-500/18 text-violet-700 dark:text-violet-300",
  code: "bg-blue-500/18 text-blue-700 dark:text-blue-300",
  terminal: "bg-teal-500/18 text-teal-700 dark:text-teal-300",
  checks: "bg-sky-500/18 text-sky-700 dark:text-sky-300",
  ready: "bg-emerald-500/18 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/18 text-red-700 dark:text-red-300",
  quiet: "bg-foreground/8 font-medium text-muted-foreground",
};

const STAGE_DOT: Record<HomeStage, string> = {
  "needs-you": "bg-amber-400 ring-3 ring-amber-400/25",
  thinking: "bg-violet-400 ring-3 ring-violet-400/20",
  code: "bg-blue-400 ring-3 ring-blue-400/20",
  terminal: "bg-teal-400 ring-3 ring-teal-400/20",
  checks: "bg-pink-400 ring-3 ring-pink-400/20",
  ready: "bg-emerald-400",
  failed: "bg-red-400",
  quiet: "bg-orange-400",
};

const CARD = "orchestrator-home-card flex min-h-0 min-w-0 flex-col rounded-3xl border";
const SUB = "rounded-xl border border-(--oh-sub-border) bg-(--oh-sub)";

function greeting(nowMs: number): string {
  const hour = new Date(nowMs).getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function threadRefOf(thread: EnvironmentThreadShell): ScopedThreadRef {
  return scopeThreadRef(thread.environmentId, thread.id);
}

function StagePill(props: { readonly stage: HomeStage }) {
  return (
    <span
      className={cn(
        "inline-flex h-6.5 shrink-0 items-center rounded-full px-2.75 text-xs font-semibold whitespace-nowrap",
        STAGE_PILL[props.stage],
      )}
    >
      {HOME_STAGE_LABEL[props.stage]}
    </span>
  );
}

/** Ticks once a second on its own, so a running row does not re-render with it. */
function LiveTimer(props: { readonly thread: EnvironmentThreadShell; readonly startedAt: string }) {
  const now = toServerClock(props.thread.environmentId, useNowSecond());
  return formatHomeTimer(now - Date.parse(props.startedAt));
}

function ThreadTimer(props: { readonly row: HomeThreadRow }) {
  const { thread, state } = props.row;
  const run = thread.latestRun;
  const startedAt = resolveThreadWorkingStartedAt(thread);
  if ((state === "busy" || state === "needs-you") && startedAt !== null) {
    return <LiveTimer thread={thread} startedAt={startedAt} />;
  }
  if (state !== "quiet" && run?.startedAt != null && run.completedAt != null) {
    return formatHomeTimer(Date.parse(run.completedAt) - Date.parse(run.startedAt));
  }
  return <RelativeTime timestamp={thread.updatedAt} />;
}

interface RowProps {
  readonly row: HomeThreadRow;
  readonly meta: string;
}

function RowBody(props: RowProps & { readonly stage: HomeStage; readonly line: ReactNode }) {
  return (
    <>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[props.stage])} />
      <span className="flex w-28 shrink-0 flex-col gap-px sm:w-40">
        <span className="truncate text-sm font-semibold text-foreground">
          {props.row.thread.title}
        </span>
        <span className="truncate text-2xs text-muted-foreground">{props.meta}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/70">{props.line}</span>
      <span className="shrink-0 font-mono text-2xs font-medium text-muted-foreground tabular-nums">
        <ThreadTimer row={props.row} />
      </span>
      <StagePill stage={props.stage} />
    </>
  );
}

/** What a blocked row is asking for; the thread list only says that it is asking. */
function RequestRow(props: RowProps) {
  const requests = useAtomValue(
    environmentThreadDetails.pendingRequestsAtom(threadRefOf(props.row.thread)),
  );
  const approval = requests?.approvals[0];
  const line =
    approval !== undefined
      ? `Approve: ${approval.detail ?? approval.reason ?? "a request"}`
      : (requests?.userInputs[0]?.questions[0]?.question ?? "Waiting for your answer");
  return <RowBody {...props} stage="needs-you" line={line} />;
}

/** Stage and line of a live row. Mounting it loads the thread, so quiet rows never do. */
function ActivityRow(props: RowProps) {
  const { thread, state } = props.row;
  const items = useThreadVisibleTurnItems(threadRefOf(thread));
  if (state === "busy") {
    const activity = describeLatestActivity(items);
    return (
      <RowBody
        {...props}
        stage={activity?.stage ?? "thinking"}
        line={activity?.line ?? "Working"}
      />
    );
  }
  const failed = state === "failed";
  return (
    <RowBody
      {...props}
      stage={failed ? "failed" : "ready"}
      line={
        failed
          ? (thread.runtime?.lastError ?? "The run failed")
          : (describeLastReply(items) ?? "Finished")
      }
    />
  );
}

function ThreadRow(
  props: RowProps & { readonly onOpen: (thread: EnvironmentThreadShell) => void },
) {
  const { thread, state } = props.row;
  return (
    <li>
      <button
        type="button"
        data-orchestrator-thread-row={state}
        onClick={() => props.onOpen(thread)}
        className={cn(
          SUB,
          "flex w-full cursor-pointer items-center gap-2.75 px-3.25 py-2.5 text-start outline-none hover:bg-(--oh-sub-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          state === "needs-you" &&
            "border-warning/30 bg-linear-to-r from-warning/12 to-(--oh-sub) to-50%",
        )}
      >
        {state === "quiet" ? (
          <RowBody row={props.row} meta={props.meta} stage="quiet" line={quietLine(thread)} />
        ) : state === "needs-you" ? (
          <RequestRow row={props.row} meta={props.meta} />
        ) : (
          <ActivityRow row={props.row} meta={props.meta} />
        )}
      </button>
    </li>
  );
}

function StatTile(props: {
  readonly value: number;
  readonly label: string;
  readonly tone: string;
}) {
  return (
    <div className={cn(SUB, "flex flex-col gap-0.75 px-3.75 pt-2.75 pb-3")}>
      <span
        className={cn(
          "text-2xl leading-tight font-semibold tracking-tight tabular-nums",
          props.tone,
        )}
      >
        {props.value}
      </span>
      <span className="text-xs text-muted-foreground">{props.label}</span>
    </div>
  );
}

const ACTIVITY_ICON: Record<HomeActivityEntry["kind"], readonly [LucideIcon, string]> = {
  merged: [PullRequestGlyph.merged, "bg-violet-500/20 text-violet-600 dark:text-violet-300"],
  finished: [CheckIcon, "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"],
  failed: [XIcon, "bg-red-500/20 text-red-600 dark:text-red-300"],
  started: [PlayIcon, "bg-blue-500/20 text-blue-600 dark:text-blue-300"],
};

function RecentActivityRow(props: {
  readonly entry: HomeActivityEntry;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const { entry } = props;
  const [Icon, tone] = ACTIVITY_ICON[entry.kind];
  return (
    <li>
      <button
        type="button"
        onClick={() => props.onOpen(entry.thread)}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md text-start text-xs text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className={cn("grid size-5.5 shrink-0 place-items-center rounded-full", tone)}>
          <Icon aria-hidden className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <b className="font-semibold text-foreground">{entry.thread.title}</b> · {entry.text}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground/70">
          <RelativeTime timestamp={entry.at} />
        </span>
      </button>
    </li>
  );
}

function ReadyLine(props: { readonly thread: EnvironmentThreadShell; readonly failed: boolean }) {
  const items = useThreadVisibleTurnItems(threadRefOf(props.thread));
  const line = props.failed
    ? (props.thread.runtime?.lastError ?? "The run failed")
    : (describeLastReply(items) ?? "Finished");
  return <p className="min-w-0 flex-1 truncate text-xs text-foreground/70">{line}</p>;
}

function TriageItem(props: {
  readonly row: HomeThreadRow;
  readonly meta: string;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const { thread, state } = props.row;
  const at =
    state === "needs-you" ? thread.updatedAt : (thread.latestRun?.completedAt ?? thread.updatedAt);
  return (
    <li
      data-orchestrator-triage={state}
      className={cn(SUB, "flex flex-col gap-1.25 px-3.25 py-2.75")}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex h-5.5 min-w-0 items-center gap-1.25 truncate rounded-full px-2.25 text-2xs font-medium",
            STAGE_PILL[state === "busy" ? "thinking" : state],
          )}
        >
          <span className="truncate">{props.meta}</span>
          <span aria-hidden>·</span>
          <span className="font-mono tabular-nums">
            <ThreadTimer row={props.row} />
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground/70 tabular-nums">
          <RelativeTime timestamp={at} />
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {thread.title}
          <span className="ms-2 font-normal text-muted-foreground">
            {HOME_STAGE_LABEL[state === "busy" ? "thinking" : state]}
          </span>
        </span>
        <Button size="sm-pill" variant="outline" onClick={() => props.onOpen(thread)}>
          Open
        </Button>
      </div>
      {state === "needs-you" ? (
        <div className="-mx-2">
          <NeedsYouRequest thread={thread} />
        </div>
      ) : (
        <ReadyLine thread={thread} failed={state === "failed"} />
      )}
    </li>
  );
}

/** The orchestrator thread's own chat and composer, as a side chat is shown in a panel. */
function OrchestratorChat(props: {
  readonly thread: EnvironmentThreadShell;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const { thread, onOpen } = props;
  const threadRef = threadRefOf(thread);
  // The home has no diff panel or terminal drawer, so both open the thread itself.
  const parentPanel: SideChatParentPanel = {
    hostRef: threadRef,
    openToolDiff: () => onOpen(thread),
    runShellCommand: () => onOpen(thread),
  };
  return (
    <div data-side-chat-pane={thread.id} className="flex min-h-0 flex-1 flex-col">
      <BackgroundThreadContext value>
        <ComposerHandleContext value={null}>
          <ChatView
            environmentId={thread.environmentId}
            threadId={thread.id}
            routeKind="server"
            embedded={parentPanel}
          />
        </ComposerHandleContext>
      </BackgroundThreadContext>
    </div>
  );
}

export function OrchestratorHome() {
  const navigate = useNavigate();
  const threads = useVisibleThreadShells();
  const projects = useProjects();
  const providers = useEnvironmentProviders();
  const chosenKey = useClientSettings((settings) => settings.orchestratorThreadKey);
  // The rows only need the minute; each running timer keeps its own second.
  const nowMs = Math.floor(useNowSecond() / 60_000) * 60_000;

  const orchestrator = resolveOrchestratorThread(threads, projects, chosenKey);
  const rows = selectHomeThreadRows(
    threads,
    orchestrator === null ? null : homeThreadKey(orchestrator),
    nowMs,
  );
  const triage = rows.filter((row) => row.state !== "busy" && row.state !== "quiet");
  const activity = selectRecentActivity(threads, 2);
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title] as const),
  );
  const providerEntries = deriveProviderEntriesByEnvironment(
    [...providers].map(([environmentId, list]) => [environmentId, list] as const),
  );
  const metaOf = (thread: EnvironmentThreadShell) => {
    const entry = providerEntries
      .get(thread.environmentId)
      ?.get(thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId);
    const model = entry?.models.find((candidate) => candidate.slug === thread.modelSelection.model);
    const modelLabel = model
      ? getTriggerDisplayModelName(model, entry?.driverKind)
      : thread.modelSelection.model;
    const project = projectTitles.get(`${thread.environmentId}:${thread.projectId}`);
    return project === undefined ? modelLabel : `${project} · ${modelLabel}`;
  };
  const openThread = (thread: EnvironmentThreadShell) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRefOf(thread)),
    });
  };
  const projectCount = new Set(
    rows.map((row) => `${row.thread.environmentId}:${row.thread.projectId}`),
  ).size;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div
        data-orchestrator-home=""
        className="orchestrator-home relative flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pt-5.5 pb-6.5 lg:px-8"
      >
        <header className="drag-region relative flex shrink-0 items-center justify-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {greeting(nowMs)}
          </h1>
          <div className="absolute end-0 [-webkit-app-region:no-drag]">
            <Button size="sm-pill" variant="outline" render={<Link to="/settings/labs" />}>
              Settings
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4.5 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <section
              aria-label="Needs you"
              className={cn(CARD, "max-h-[36%] shrink-0 px-4.5 py-4 max-lg:max-h-none")}
            >
              <div className="mb-3.25 flex shrink-0 items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">Orchestrator · Needs you</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {triage.length === 0 ? "All clear" : `${triage.length} waiting`}
                </span>
              </div>
              {triage.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing is waiting on you. Finished threads and requests show up here.
                </p>
              ) : (
                <ul className="-me-2 flex min-h-0 flex-col gap-2.25 overflow-y-auto pe-2">
                  {triage.map((row) => (
                    <TriageItem
                      key={homeThreadKey(row.thread)}
                      row={row}
                      meta={metaOf(row.thread)}
                      onOpen={openThread}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-label="Coding threads and output"
              className={cn(CARD, "flex-1 px-5 py-4.5")}
            >
              <div className="mb-3.25 flex shrink-0 items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">
                  Coding Threads &amp; Output
                </h2>
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  Today across {projectCount} {projectCount === 1 ? "project" : "projects"}
                </span>
              </div>
              <div className="mb-3 grid shrink-0 grid-cols-3 gap-2.75">
                <StatTile
                  value={countMergedToday(threads, nowMs)}
                  label="Shipped today"
                  tone="text-emerald-600 dark:text-emerald-400"
                />
                <StatTile
                  value={triage.length}
                  label="Needs you"
                  tone="text-amber-600 dark:text-amber-400"
                />
                <StatTile
                  value={rows.filter((row) => row.state === "busy").length}
                  label="Running now"
                  tone="text-blue-600 dark:text-blue-400"
                />
              </div>
              {rows.length === 0 ? (
                <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  No threads have been active in the last day.
                </p>
              ) : (
                <ul className="-me-2 flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto pe-2 max-lg:max-h-96 max-lg:flex-none">
                  {rows.map((row) => (
                    <ThreadRow
                      key={homeThreadKey(row.thread)}
                      row={row}
                      meta={metaOf(row.thread)}
                      onOpen={openThread}
                    />
                  ))}
                </ul>
              )}
              {activity.length > 0 ? (
                <ul className="mt-3 flex shrink-0 flex-col gap-2 border-t border-(--oh-sub-border) pt-2.75">
                  {activity.map((entry) => (
                    <RecentActivityRow key={entry.key} entry={entry} onOpen={openThread} />
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
          <section
            aria-label="Orchestrator chat"
            className={cn(CARD, "orchestrator-home-chat min-h-80 flex-1 overflow-hidden")}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 px-4.5 pt-4 pb-2">
              <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
                <BotIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {orchestrator === null || /orchestrator/i.test(orchestrator.title)
                    ? "Orchestrator"
                    : `Orchestrator · ${orchestrator.title}`}
                </span>
              </h2>
              {orchestrator === null ? null : (
                <Button size="sm-pill" variant="outline" onClick={() => openThread(orchestrator)}>
                  Open
                </Button>
              )}
            </div>
            {orchestrator === null ? (
              <p className="px-4.5 text-xs text-muted-foreground">
                Pin the thread you talk to, or choose one in Settings → Labs.
              </p>
            ) : (
              <OrchestratorChat
                key={homeThreadKey(orchestrator)}
                thread={orchestrator}
                onOpen={openThread}
              />
            )}
          </section>
        </div>
      </div>
    </SidebarInset>
  );
}
