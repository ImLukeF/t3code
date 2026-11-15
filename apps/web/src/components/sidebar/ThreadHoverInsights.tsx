import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { collectProviderUsageLimits } from "@t3tools/shared/usageLimits";
import { CircleAlertIcon } from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { useThreadProjection } from "~/state/entities";
import { useEnvironment, useEnvironmentProviders } from "~/state/environments";
import { environmentThreadDetails } from "~/state/threads";
import { useThreadClash } from "./SidebarRowBadges";

type HoverThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "providerInstanceId" | "runtime"
>;

/** The last lines the agent wrote, so a thread can be triaged without opening it. */
function LatestAgentText(props: { readonly thread: HoverThread }) {
  const items = useAtomValue(
    environmentThreadDetails.visibleTurnItemsAtom(
      scopeThreadRef(props.thread.environmentId, props.thread.id),
    ),
  );
  let text: string | null = null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]?.item;
    if (item?.type === "assistant_message" && item.text.trim().length > 0) {
      text = item.text.trim();
      break;
    }
  }
  if (text === null) return null;
  return (
    <p className="line-clamp-3 border-l-2 border-border ps-2 text-foreground/85 wrap-break-word">
      {text}
    </p>
  );
}

/** Tokens this thread has used, beside the provider's own limit windows. */
function ThreadUsage(props: { readonly thread: HoverThread }) {
  const { thread } = props;
  const projection = useThreadProjection(scopeThreadRef(thread.environmentId, thread.id));
  const providers = useEnvironmentProviders().get(thread.environmentId) ?? [];
  const sources = useEnvironment(thread.environmentId)?.serverConfig?.usageLimitSources;
  const nowMinute = useNowMinute();
  let tokens = 0;
  for (const turn of projection?.projection.providerTurns ?? []) {
    const usage = turn.turnTokenUsage as
      | { readonly inputTokens?: number; readonly outputTokens?: number }
      | undefined;
    tokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  }
  const instanceId = thread.runtime?.providerInstanceId ?? thread.providerInstanceId;
  const report =
    sources === undefined
      ? null
      : collectProviderUsageLimits(instanceId, providers, sources, Date.parse(`${nowMinute}:00Z`));
  const windows =
    report?.accounts.find((entry) => entry.instanceId === instanceId)?.limits?.windows ??
    providers.find((provider) => provider.instanceId === instanceId)?.usageLimits?.windows ??
    [];
  if (tokens === 0 && windows.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {tokens > 0 ? (
        <div className="text-foreground/75">
          {formatContextWindowTokens(tokens)} tokens this thread
        </div>
      ) : null}
      {windows.length > 0 ? (
        <div className="truncate text-muted-foreground">
          Limits ·{" "}
          {windows
            .map((window) => `${window.label} ${Math.round(window.usedPercent)}%`)
            .join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function ThreadClashNote(props: { readonly thread: HoverThread }) {
  const clash = useThreadClash(props.thread);
  if (clash === null) return null;
  return (
    <div className="flex min-w-0 items-start gap-2 text-error">
      <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
      <div className="min-w-0 flex-1 wrap-break-word">
        {clash.kind === "folder"
          ? `Working in the same folder as “${clash.otherTitle}”`
          : `Also touched ${clash.file ?? "a file"} in “${clash.otherTitle}”`}
      </div>
    </div>
  );
}

/** Extra hover-card lines; mounting them subscribes to the thread, so they only render on hover. */
export function ThreadHoverInsights(props: { readonly thread: HoverThread }) {
  return (
    <>
      <LatestAgentText thread={props.thread} />
      <ThreadClashNote thread={props.thread} />
      <ThreadUsage thread={props.thread} />
    </>
  );
}
