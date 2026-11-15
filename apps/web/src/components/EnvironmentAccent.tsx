import type { EnvironmentId } from "@t3tools/contracts";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "~/state/environments";

/**
 * Calm hues that read on light and dark surfaces and stay clear of the status colours
 * (blue running, amber needs you, green done, red failed).
 */
const ENVIRONMENT_ACCENTS = ["#8B5CF6", "#06B6D4", "#6366F1"] as const;

/** A stable colour for each remote environment. This machine stays neutral. */
function environmentAccentColor(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
): string | null {
  if (environmentId === primaryEnvironmentId) return null;
  let hash = 2166136261;
  for (let index = 0; index < environmentId.length; index += 1) {
    hash ^= environmentId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ENVIRONMENT_ACCENTS[(hash >>> 0) % ENVIRONMENT_ACCENTS.length] ?? null;
}

function useEnvironmentAccentColor(environmentId: EnvironmentId | null): string | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return environmentId === null
    ? null
    : environmentAccentColor(environmentId, primaryEnvironmentId);
}

/**
 * A tinted-glass wash of the environment's colour over a row; none for this machine.
 * `dimmed` rows are drawn at reduced opacity, so their tint is raised to read the same.
 */
export function useEnvironmentTintStyle(
  environmentId: EnvironmentId | null,
  options?: { readonly dimmed?: boolean },
): CSSProperties | undefined {
  const color = useEnvironmentAccentColor(environmentId);
  if (color === null) return undefined;
  const boost = options?.dimmed ? 1.45 : 1;
  const tint = (percent: number) =>
    `color-mix(in srgb, ${color} ${Math.round(percent * boost)}%, transparent)`;
  // Tinted glass: a soft diagonal wash, a faint edge in the same hue and a thin top highlight.
  return {
    backgroundImage: `linear-gradient(135deg, ${tint(9)}, ${tint(3)})`,
    boxShadow: `inset 0 0 0 1px ${tint(14)}, inset 0 1px 0 rgb(255 255 255 / 0.05)`,
  };
}

/** A small dot in the environment's colour; renders nothing for this machine. */
export function EnvironmentAccentDot(props: {
  readonly environmentId: EnvironmentId | null;
  readonly className?: string;
}) {
  const color = useEnvironmentAccentColor(props.environmentId);
  if (color === null) return null;
  return (
    <span
      aria-hidden
      data-environment-accent=""
      className={cn("inline-block size-2 shrink-0 rounded-full", props.className)}
      style={{ backgroundColor: color }}
    />
  );
}
