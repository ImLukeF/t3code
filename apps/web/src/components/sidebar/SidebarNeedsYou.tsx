import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ThreadPendingApproval } from "@t3tools/client-runtime/state/thread-requests";
import type { EnvironmentId, ProviderApprovalDecision, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { Button } from "../ui/button";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveSidebarThreadStatus,
  type SidebarThreadStatus,
} from "../Sidebar.logic";

/** Fired after the composer sends from an existing thread; the sidebar then moves on. */
export const COMPOSER_SENT_EVENT = "t3luke:composer-sent";

export function announceComposerSent(environmentId: EnvironmentId, threadId: ThreadId): void {
  window.dispatchEvent(
    new CustomEvent<string>(COMPOSER_SENT_EVENT, {
      detail: scopedThreadKey(scopeThreadRef(environmentId, threadId)),
    }),
  );
}

const NEEDS_YOU_LABEL: Partial<Record<SidebarThreadStatus, string>> = {
  approval: "Approval",
  input: "Input",
  request: "Request",
};

/** Threads blocked on the user: an approval, a question, or a guest request. */
export function selectNeedsYouThreads(
  threads: readonly EnvironmentThreadShell[],
): readonly EnvironmentThreadShell[] {
  return threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      NEEDS_YOU_LABEL[resolveSidebarThreadStatus(thread)] !== undefined,
  );
}

function isAttentionThread(thread: EnvironmentThreadShell): boolean {
  if (thread.archivedAt !== null || thread.deletedAt !== null) return false;
  if (NEEDS_YOU_LABEL[resolveSidebarThreadStatus(thread)] !== undefined) return true;
  return resolveSidebarRowStatus(thread) === "ready" && hasUnseenCompletion(thread);
}

/**
 * Where to go after sending: the next thread below the sent one, in sidebar order, that
 * needs you or finished unread. Only once nothing is left below does it wrap to the top.
 */
export function selectNextAttentionThread(
  threads: readonly EnvironmentThreadShell[],
  sentThreadKey: string,
): EnvironmentThreadShell | undefined {
  const sentIndex = threads.findIndex(
    (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === sentThreadKey,
  );
  // With the sent thread not listed, the sweep starts at the top.
  for (let step = 1; step <= threads.length; step += 1) {
    const index = (sentIndex + step) % threads.length;
    const thread = threads[index];
    if (index !== sentIndex && thread !== undefined && isAttentionThread(thread)) return thread;
  }
  return undefined;
}

const APPROVAL_KIND_LABEL: Record<ThreadPendingApproval["requestKind"], string> = {
  command: "Run a command",
  "file-read": "Read a file",
  "file-change": "Change files",
  "mcp-elicitation": "Answer a tool",
  permission: "Grant a permission",
};

/**
 * What the thread is waiting on, with Approve / Deny for approvals. Mounting this
 * subscribes to the thread's detail, so it only renders for threads in the list.
 */
function NeedsYouRequest(props: { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  const requests = useAtomValue(
    environmentThreadDetails.pendingRequestsAtom(scopeThreadRef(thread.environmentId, thread.id)),
  );
  const respondToApproval = useOrchestrationCommand(threadEnvironment.respondToApproval);
  const [responding, setResponding] = useState(false);
  const approval = requests?.approvals[0] ?? null;
  const question = requests?.userInputs[0]?.questions[0] ?? null;

  if (approval !== null) {
    const respond = async (decision: ProviderApprovalDecision) => {
      setResponding(true);
      await respondToApproval({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, requestId: approval.requestId, decision },
      });
      setResponding(false);
    };
    const canRespond = approval.responseCapability === "live" && !responding;
    return (
      <div className="flex flex-col gap-1.5 px-2 pb-1.5">
        <p className="truncate font-mono text-xs text-muted-foreground">
          {approval.detail ?? approval.reason ?? APPROVAL_KIND_LABEL[approval.requestKind]}
        </p>
        <div className="flex gap-1.5">
          <Button size="compact" disabled={!canRespond} onClick={() => void respond("accept")}>
            Approve
          </Button>
          <Button
            size="compact"
            variant="outline"
            disabled={!canRespond}
            onClick={() => void respond("decline")}
          >
            Deny
          </Button>
        </div>
      </div>
    );
  }
  if (question !== null) {
    return (
      <p className="line-clamp-2 px-2 pb-1.5 text-xs text-muted-foreground">{question.question}</p>
    );
  }
  return null;
}

/** A pinned list above the sidebar threads, so a blocked thread is never buried. */
export function SidebarNeedsYou(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly activeThreadKey: string | null;
  readonly threadKey: (thread: EnvironmentThreadShell) => string;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  if (props.threads.length === 0) return null;
  return (
    <section
      data-sidebar-needs-you=""
      aria-label="Needs you"
      className="mx-2 mb-2 rounded-lg border border-warning/30 bg-warning/8 p-1"
    >
      <div className="flex items-center justify-between px-2 pt-0.5 pb-1 text-xs font-medium text-warning-foreground">
        <span>Needs you</span>
        <span className="tabular-nums">{props.threads.length}</span>
      </div>
      <ul className="flex flex-col gap-px">
        {props.threads.map((thread) => {
          const key = props.threadKey(thread);
          const label = NEEDS_YOU_LABEL[resolveSidebarThreadStatus(thread)];
          return (
            <li key={key} className="rounded-md bg-background/40">
              <button
                type="button"
                aria-current={key === props.activeThreadKey ? "page" : undefined}
                onClick={() => props.onSelect(thread)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-sm text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  key === props.activeThreadKey && "bg-sidebar-row-active",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                <span className="shrink-0 text-xs font-medium text-warning-foreground">
                  {label}
                </span>
              </button>
              <NeedsYouRequest thread={thread} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
