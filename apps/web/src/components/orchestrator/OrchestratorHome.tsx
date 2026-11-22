import { toServerClock } from "@t3tools/client-runtime/clock";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveThreadWorkingStartedAt,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { CheckIcon, EllipsisIcon, type LucideIcon, PlayIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ComposerHandleContext } from "~/composerHandleContext";
import { useNowSecond } from "~/hooks/useNowSecond";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { cn, newMessageId } from "~/lib/utils";
import { deriveProviderEntriesByEnvironment } from "~/providerInstances";
import { useProjects, useThreadVisibleTurnItems, useVisibleThreadShells } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { RelativeTime } from "../RelativeTime";
import { useThreadRequestLine } from "../sidebar/SidebarNeedsYou";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import {
  DEPLOY_STATUS_LABEL,
  describeLastReply,
  describeLatestActivity,
  formatHomeTimer,
  HOME_STAGE_LABEL,
  homeThreadKey,
  homeThreadRow,
  quietLine,
  resolveOrchestratorThread,
  selectDeployQueue,
  selectHomeThreadRows,
  selectRecentActivity,
  selectShipEvents,
  selectShippedToday,
  shipRequestText,
  type DeployQueueEntry,
  type DeployStatus,
  type HomeActivityEntry,
  type HomeStage,
  type HomeThreadRow,
} from "./orchestratorHome.logic";
import {
  HOME_PANELS,
  type HomeColumn,
  type HomeLayout,
  type HomePanelId,
  type HomePanelMove,
  homePanelMoves,
  moveHomePanel,
  normalizeHomeLayout,
} from "./homeLayout.logic";

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

function threadRefOf(thread: EnvironmentThreadShell): ScopedThreadRef {
  return scopeThreadRef(thread.environmentId, thread.id);
}

const PILL =
  "inline-flex h-6.5 shrink-0 items-center rounded-full px-2.75 text-xs font-semibold whitespace-nowrap";

function StagePill(props: { readonly stage: HomeStage }) {
  const m = useMessages();
  return (
    <span className={cn(PILL, STAGE_PILL[props.stage])}>{m(HOME_STAGE_LABEL[props.stage])}</span>
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

function QuietRow(props: RowProps) {
  const m = useMessages();
  return <RowBody {...props} stage="quiet" line={quietLine(props.row.thread, m)} />;
}

/** What a blocked row is asking for; the thread list only says that it is asking. */
function RequestRow(props: RowProps) {
  const gt = useGT();
  const line = useThreadRequestLine(props.row.thread) ?? gt("Waiting for your answer");
  return <RowBody {...props} stage="needs-you" line={line} />;
}

/** Stage and line of a live row. Mounting it loads the thread, so quiet rows never do. */
function ActivityRow(props: RowProps) {
  const { thread, state } = props.row;
  const gt = useGT();
  const m = useMessages();
  const items = useThreadVisibleTurnItems(threadRefOf(thread));
  if (state === "busy") {
    const activity = describeLatestActivity(items, m);
    return (
      <RowBody
        {...props}
        stage={activity?.stage ?? "thinking"}
        line={activity?.line ?? gt("Working", { $context: "an agent is busy" })}
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
          ? (thread.runtime?.lastError ?? gt("The run failed"))
          : (describeLastReply(items) ?? gt("Finished", { $context: "an agent finished its run" }))
      }
    />
  );
}

interface ShipControl {
  /** Thread keys already in the queue, or being asked for now. */
  readonly requested: ReadonlySet<string>;
  readonly request: (thread: EnvironmentThreadShell) => void;
}

/** Asks the orchestrator to merge and deploy a thread; it drives the thread and reports back. */
function ShipButton(props: {
  readonly thread: EnvironmentThreadShell;
  readonly ship: ShipControl;
}) {
  if (props.ship.requested.has(homeThreadKey(props.thread))) return null;
  return (
    <Button
      size="sm-pill"
      data-orchestrator-ship=""
      onClick={() => props.ship.request(props.thread)}
    >
      <T context="verb, release this work">Ship</T>
    </Button>
  );
}

function ThreadRow(
  props: RowProps & {
    readonly onOpen: (thread: EnvironmentThreadShell) => void;
    /** Absent when there is no orchestrator to ask. */
    readonly ship: ShipControl | null;
  },
) {
  const { thread, state } = props.row;
  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        data-orchestrator-thread-row={state}
        onClick={() => props.onOpen(thread)}
        className={cn(
          SUB,
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2.75 px-3.25 py-2.5 text-start outline-none hover:bg-(--oh-sub-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          state === "needs-you" &&
            "border-warning/30 bg-linear-to-r from-warning/12 to-(--oh-sub) to-50%",
        )}
      >
        {state === "quiet" ? (
          <QuietRow row={props.row} meta={props.meta} />
        ) : state === "needs-you" ? (
          <RequestRow row={props.row} meta={props.meta} />
        ) : (
          <ActivityRow row={props.row} meta={props.meta} />
        )}
      </button>
      {state === "ready" && props.ship !== null ? (
        <ShipButton thread={thread} ship={props.ship} />
      ) : null}
    </li>
  );
}

/** A count that filters the thread list to what it counts; pressing it again clears the filter. */
function StatTile(props: {
  readonly value: number;
  readonly label: string;
  readonly tone: string;
  readonly pressed: boolean;
  readonly onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      onClick={props.onPress}
      className={cn(
        SUB,
        "flex cursor-pointer flex-col gap-0.75 px-3.75 pt-2.75 pb-3 text-start outline-none hover:bg-(--oh-sub-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        props.pressed && "border-foreground/45 bg-(--oh-sub-hover)",
      )}
    >
      <span
        className={cn(
          "text-2xl leading-tight font-semibold tracking-tight tabular-nums",
          props.tone,
        )}
      >
        {props.value}
      </span>
      <span className="text-xs text-muted-foreground">{props.label}</span>
    </button>
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

const DEPLOY_PILL: Record<DeployStatus, HomeStage> = {
  requested: "needs-you",
  committed: "quiet",
  pending: "code",
  checks: "checks",
  blocked: "failed",
  draft: "quiet",
  merged: "thinking",
  deploying: "terminal",
  live: "ready",
  failed: "failed",
};

/** One line of timing: how long it has sat in this step, or when it went live and how long it took. */
function DeployTiming(props: { readonly entry: DeployQueueEntry }) {
  const { entry } = props;
  const since = <RelativeTime timestamp={new Date(entry.at).toISOString()} />;
  if (entry.status !== "live" || entry.at <= entry.startedAt) return since;
  return (
    <T>
      {since} · took <span>{formatHomeTimer(entry.at - entry.startedAt)}</span>
    </T>
  );
}

function DeployQueueRow(props: {
  readonly entry: DeployQueueEntry;
  readonly project: string | null;
  readonly ship: ShipControl | null;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const { entry } = props;
  const m = useMessages();
  const detail = [props.project, entry.pullRequest].filter((part) => part !== null).join(" · ");
  return (
    <li className="flex items-center gap-2" data-orchestrator-deploy-row={entry.status}>
      <button
        type="button"
        onClick={() => props.onOpen(entry.thread)}
        className={cn(
          SUB,
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3.25 py-2 text-start outline-none hover:bg-(--oh-sub-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-sm font-semibold text-foreground">
            {entry.thread.title}
          </span>
          <span className="truncate text-2xs text-muted-foreground">{detail}</span>
        </span>
        <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
          <DeployTiming entry={entry} />
        </span>
        <span className={cn(PILL, STAGE_PILL[DEPLOY_PILL[entry.status]])}>
          {m(DEPLOY_STATUS_LABEL[entry.status])}
        </span>
      </button>
      {entry.status === "pending" && props.ship !== null ? (
        <ShipButton thread={entry.thread} ship={props.ship} />
      ) : null}
    </li>
  );
}

interface PanelControl {
  readonly layout: HomeLayout;
  readonly move: (id: HomePanelId, move: HomePanelMove) => void;
}

/** The frame every panel shares: a small header with its menu, and a body that scrolls itself. */
function HomePanel(props: {
  readonly id: HomePanelId;
  readonly control: PanelControl;
  readonly title?: string;
  readonly count?: number;
  /** Extra menu items, above the layout ones. */
  readonly menu?: ReactNode;
  /** The body runs edge to edge, as the chat does. */
  readonly flush?: boolean;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const m = useMessages();
  const title = props.title ?? m(HOME_PANELS[props.id]);
  const moves = homePanelMoves(props.control.layout, props.id);
  const move = (next: HomePanelMove) => () => props.control.move(props.id, next);
  return (
    <section
      aria-label={title}
      data-orchestrator-panel={props.id}
      className={cn(CARD, "flex-1 overflow-hidden max-lg:min-h-96")}
    >
      <div className="flex shrink-0 items-center gap-2 py-2.5 ps-4.5 pe-2.5">
        <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h2>
        {props.count === undefined ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">{props.count}</span>
        )}
        <div className="ms-auto">
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={gt("{panel} panel options", { panel: title })}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {props.menu}
              {props.menu === undefined ? null : <MenuSeparator />}
              <MenuItem onClick={move("other-column")}>
                <T>Move to the other column</T>
              </MenuItem>
              <MenuItem disabled={!moves.has("up")} onClick={move("up")}>
                <T>Move up</T>
              </MenuItem>
              <MenuItem disabled={!moves.has("down")} onClick={move("down")}>
                <T>Move down</T>
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={move("hide")}>
                <T>Hide panel</T>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", props.flush ? "" : "px-4.5 pb-4")}>
        {props.children}
      </div>
    </section>
  );
}

/** Brings hidden panels back and resets the layout. */
function PanelsMenu(props: { readonly control: PanelControl; readonly onReset: () => void }) {
  const m = useMessages();
  const { layout } = props.control;
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm-pill" variant="outline" />}>
        <T>Panels</T>
      </MenuTrigger>
      <MenuPopup align="end">
        {(Object.keys(HOME_PANELS) as HomePanelId[]).map((id) => {
          const shown = layout.left.includes(id) || layout.right.includes(id);
          return (
            <MenuCheckboxItem
              key={id}
              checked={shown}
              closeOnClick={false}
              onCheckedChange={() => props.control.move(id, shown ? "hide" : "show")}
            >
              {m(HOME_PANELS[id])}
            </MenuCheckboxItem>
          );
        })}
        <MenuSeparator />
        <MenuItem onClick={props.onReset}>
          <T>Reset layout</T>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

const HOME_COLUMNS: readonly HomeColumn[] = ["left", "right"];

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
    <div
      data-side-chat-pane={thread.id}
      className="orchestrator-home-chat flex min-h-0 flex-1 flex-col"
    >
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

type ThreadFilter = "shipped" | "needs-you" | "running";

export function OrchestratorHome() {
  const navigate = useNavigate();
  const gt = useGT();
  const m = useMessages();
  const threads = useVisibleThreadShells();
  const projects = useProjects();
  const providers = useEnvironmentProviders();
  const chosenKey = useClientSettings((settings) => settings.orchestratorThreadKey);
  // The rows only need the minute; each running timer keeps its own second.
  const nowMs = Math.floor(useNowSecond() / 60_000) * 60_000;
  const hour = new Date(nowMs).getHours();

  const orchestrator = resolveOrchestratorThread(threads, projects, chosenKey);
  const rows = selectHomeThreadRows(
    threads,
    orchestrator === null ? null : homeThreadKey(orchestrator),
    nowMs,
  );
  const needsYou = rows.filter((row) => row.state !== "busy" && row.state !== "quiet");
  const running = rows.filter((row) => row.state === "busy");

  const layout = normalizeHomeLayout(
    useClientSettings((settings) => settings.orchestratorHomeLayout),
  );
  const saveLayout = (next: HomeLayout | null) =>
    void updateClientSettings({
      orchestratorHomeLayout:
        next === null ? null : { left: [...next.left], right: [...next.right] },
    });
  const control: PanelControl = {
    layout,
    move: (id, move) => saveLayout(moveHomePanel(layout, id, move)),
  };
  const logShown = layout.left.includes("log") || layout.right.includes("log");
  const [filter, setFilter] = useState<ThreadFilter | null>(null);
  const toggleFilter = (next: ThreadFilter) =>
    setFilter((current) => (current === next ? null : next));
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn);
  // Covers the moment between the click and the message showing up in the orchestrator's chat.
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const orchestratorItems = useThreadVisibleTurnItems(
    orchestrator === null ? null : threadRefOf(orchestrator),
  );
  const shipEvents =
    orchestrator === null ? [] : selectShipEvents(orchestratorItems, orchestrator.environmentId);
  const deployQueue = selectDeployQueue(threads, shipEvents, nowMs);
  const shipped = selectShippedToday(threads, shipEvents, nowMs);
  const ship: ShipControl | null =
    orchestrator === null
      ? null
      : {
          requested: new Set([
            ...sending,
            ...deployQueue
              .filter((entry) => entry.status !== "pending")
              .map((entry) => homeThreadKey(entry.thread)),
          ]),
          request: (thread) => {
            const key = homeThreadKey(thread);
            setSending((current) => new Set(current).add(key));
            void startTurn({
              environmentId: orchestrator.environmentId,
              input: {
                threadId: orchestrator.id,
                message: {
                  messageId: newMessageId(),
                  role: "user",
                  text: shipRequestText(thread),
                  attachments: [],
                },
                runtimeMode: orchestrator.runtimeMode,
                interactionMode: orchestrator.interactionMode,
                // A busy orchestrator takes the request once its current turn ends.
                dispatchMode: "queue",
              },
            }).then(() =>
              setSending((current) => {
                const next = new Set(current);
                next.delete(key);
                return next;
              }),
            );
          },
        };
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title] as const),
  );
  const projectOf = (thread: EnvironmentThreadShell) =>
    projectTitles.get(`${thread.environmentId}:${thread.projectId}`) ?? null;
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
    const project = projectOf(thread);
    return project === null ? modelLabel : `${project} · ${modelLabel}`;
  };
  const openThread = (thread: EnvironmentThreadShell) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRefOf(thread)),
    });
  };
  const shownRows =
    filter === "needs-you"
      ? needsYou
      : filter === "running"
        ? running
        : filter === "shipped"
          ? shipped.map(homeThreadRow)
          : rows;
  const activity = logShown ? selectRecentActivity(threads, 60, m) : [];

  const renderPanel = (id: HomePanelId) => {
    switch (id) {
      case "chat":
        return (
          <HomePanel
            key={id}
            id={id}
            control={control}
            flush
            {...(orchestrator === null || /orchestrator/i.test(orchestrator.title)
              ? { title: gt("Orchestrator") }
              : { title: gt("Orchestrator · {title}", { title: orchestrator.title }) })}
            {...(orchestrator === null
              ? {}
              : {
                  menu: (
                    <MenuItem onClick={() => openThread(orchestrator)}>
                      <T>Open as a full thread</T>
                    </MenuItem>
                  ),
                })}
          >
            {orchestrator === null ? (
              <p className="px-4.5 text-xs text-muted-foreground">
                <T>Pin the thread you talk to, or choose one in Settings → Labs.</T>
              </p>
            ) : (
              <OrchestratorChat
                key={homeThreadKey(orchestrator)}
                thread={orchestrator}
                onOpen={openThread}
              />
            )}
          </HomePanel>
        );
      case "threads":
        return (
          <HomePanel key={id} id={id} control={control} count={rows.length}>
            <div className="mb-3 grid shrink-0 grid-cols-3 gap-2.75">
              <StatTile
                value={shipped.length}
                label={gt("Shipped today")}
                tone="text-emerald-600 dark:text-emerald-400"
                pressed={filter === "shipped"}
                onPress={() => toggleFilter("shipped")}
              />
              <StatTile
                value={needsYou.length}
                label={gt("Needs you")}
                tone="text-amber-600 dark:text-amber-400"
                pressed={filter === "needs-you"}
                onPress={() => toggleFilter("needs-you")}
              />
              <StatTile
                value={running.length}
                label={gt("Running now")}
                tone="text-blue-600 dark:text-blue-400"
                pressed={filter === "running"}
                onPress={() => toggleFilter("running")}
              />
            </div>
            {shownRows.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {filter === null ? (
                  <T>No threads have been active in the last day.</T>
                ) : (
                  <T>No threads match this filter.</T>
                )}
              </p>
            ) : (
              <ul className="-me-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pe-2">
                {shownRows.map((row) => (
                  <ThreadRow
                    key={homeThreadKey(row.thread)}
                    row={row}
                    meta={metaOf(row.thread)}
                    onOpen={openThread}
                    ship={ship}
                  />
                ))}
              </ul>
            )}
          </HomePanel>
        );
      case "deploys":
        return (
          <HomePanel key={id} id={id} control={control} count={deployQueue.length}>
            {deployQueue.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                <T>
                  Open pull requests, merges and recorded deploys from the last day show up here.
                </T>
              </p>
            ) : (
              <ul className="-me-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pe-2">
                {deployQueue.map((entry) => (
                  <DeployQueueRow
                    key={homeThreadKey(entry.thread)}
                    entry={entry}
                    project={projectOf(entry.thread)}
                    ship={ship}
                    onOpen={openThread}
                  />
                ))}
              </ul>
            )}
          </HomePanel>
        );
      case "log":
        return (
          <HomePanel key={id} id={id} control={control}>
            {activity.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                <T>Nothing has happened yet.</T>
              </p>
            ) : (
              <ul className="-me-2 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pe-2">
                {activity.map((entry) => (
                  <RecentActivityRow key={entry.key} entry={entry} onOpen={openThread} />
                ))}
              </ul>
            )}
          </HomePanel>
        );
    }
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div
        data-orchestrator-home=""
        className="orchestrator-home relative flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pt-5.5 pb-6.5 lg:px-8"
      >
        <header className="drag-region relative flex shrink-0 items-center justify-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {hour < 12 ? gt("Good morning") : hour < 18 ? gt("Good afternoon") : gt("Good evening")}
          </h1>
          <div className="absolute end-0 flex items-center gap-2 [-webkit-app-region:no-drag]">
            <PanelsMenu control={control} onReset={() => saveLayout(null)} />
            <Button size="sm-pill" variant="outline" render={<Link to="/settings/labs" />}>
              <T>Settings</T>
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4.5 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          {HOME_COLUMNS.map((column) => (
            <div key={column} className="flex min-h-0 min-w-0 flex-col gap-4">
              {layout[column].length === 0 ? (
                <p className="flex flex-1 items-center justify-center rounded-3xl border border-dashed border-(--oh-card-border) text-xs text-muted-foreground max-lg:hidden">
                  <T>This column is empty. Add panels from Panels.</T>
                </p>
              ) : null}
              {layout[column].map(renderPanel)}
            </div>
          ))}
        </div>
      </div>
    </SidebarInset>
  );
}
