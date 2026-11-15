import type { EnvironmentId } from "@t3tools/contracts";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "~/state/environments";

/** Distinct hues that read on both light and dark surfaces. Amber comes first for the common case. */
const ENVIRONMENT_ACCENTS = [
  "#F59E0B",
  "#A855F7",
  "#EC4899",
  "#3B82F6",
  "#22C55E",
  "#EF4444",
  "#06B6D4",
  "#84CC16",
] as const;

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

/** A light wash of the environment's colour over a row's own background; none for this machine. */
export function useEnvironmentTintStyle(
  environmentId: EnvironmentId | null,
): CSSProperties | undefined {
  const color = useEnvironmentAccentColor(environmentId);
  if (color === null) return undefined;
  const wash = `color-mix(in srgb, ${color} 14%, transparent)`;
  return { backgroundImage: `linear-gradient(${wash}, ${wash})` };
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
