import type { OrchestratorHomeLayout } from "@t3tools/contracts";
import { msg } from "gt-react";

/** Every panel the home can show. Adding one is an entry here and a case where panels render. */
export const HOME_PANELS = {
  chat: msg("Chat", { $context: "panel holding the orchestrator conversation" }),
  threads: msg("Coding Threads"),
  deploys: msg("Deploy queue"),
  log: msg("Log", { $context: "panel listing recent activity" }),
} as const;

export type HomePanelId = keyof typeof HOME_PANELS;
export type HomeColumn = "left" | "right";

export interface HomeLayout {
  readonly left: readonly HomePanelId[];
  readonly right: readonly HomePanelId[];
}

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  left: ["threads", "deploys"],
  right: ["chat"],
};

const isPanelId = (id: string): id is HomePanelId => Object.hasOwn(HOME_PANELS, id);

/** The saved layout with unknown and repeated panels dropped; null is the default layout. */
export function normalizeHomeLayout(stored: OrchestratorHomeLayout | null): HomeLayout {
  if (stored === null) return DEFAULT_HOME_LAYOUT;
  const seen = new Set<HomePanelId>();
  const keep = (ids: readonly string[]) =>
    ids.filter(isPanelId).filter((id) => !seen.has(id) && seen.add(id) !== undefined);
  return { left: keep(stored.left), right: keep(stored.right) };
}

export function hiddenHomePanels(layout: HomeLayout): readonly HomePanelId[] {
  return (Object.keys(HOME_PANELS) as HomePanelId[]).filter(
    (id) => !layout.left.includes(id) && !layout.right.includes(id),
  );
}

export type HomePanelMove = "other-column" | "up" | "down" | "hide" | "show";

/** Which moves a panel can make from where it sits. */
export function homePanelMoves(layout: HomeLayout, id: HomePanelId): ReadonlySet<HomePanelMove> {
  const column = layout.left.includes(id)
    ? layout.left
    : layout.right.includes(id)
      ? layout.right
      : null;
  if (column === null) return new Set(["show"]);
  const index = column.indexOf(id);
  const moves = new Set<HomePanelMove>(["other-column", "hide"]);
  if (index > 0) moves.add("up");
  if (index < column.length - 1) moves.add("down");
  return moves;
}

export function moveHomePanel(
  layout: HomeLayout,
  id: HomePanelId,
  move: HomePanelMove,
): HomeLayout {
  const from: HomeColumn | null = layout.left.includes(id)
    ? "left"
    : layout.right.includes(id)
      ? "right"
      : null;
  const without = {
    left: layout.left.filter((panel) => panel !== id),
    right: layout.right.filter((panel) => panel !== id),
  };
  if (move === "hide") return without;
  if (move === "show") {
    if (from !== null) return layout;
    // A returning panel joins the emptier column, so it never crowds the chat by default.
    const to: HomeColumn = without.right.length < without.left.length ? "right" : "left";
    return { ...without, [to]: [...without[to], id] };
  }
  if (from === null) return layout;
  if (move === "other-column") {
    const to: HomeColumn = from === "left" ? "right" : "left";
    return { ...without, [to]: [...without[to], id] };
  }
  const column = [...layout[from]];
  const index = column.indexOf(id);
  const target = move === "up" ? index - 1 : index + 1;
  const swap = column[target];
  if (swap === undefined) return layout;
  column[target] = id;
  column[index] = swap;
  return { ...layout, [from]: column };
}
