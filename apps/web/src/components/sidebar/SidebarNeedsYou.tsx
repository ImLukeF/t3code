import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { cn } from "~/lib/utils";
import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "../Sidebar.logic";

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
            <li key={key}>
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
