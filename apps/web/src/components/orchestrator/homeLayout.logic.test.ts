import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_HOME_LAYOUT,
  hiddenHomePanels,
  homePanelMoves,
  moveHomePanel,
  normalizeHomeLayout,
} from "./homeLayout.logic";

describe("home layout", () => {
  it("drops unknown and repeated panels from a saved layout", () => {
    expect(normalizeHomeLayout(null)).toBe(DEFAULT_HOME_LAYOUT);
    expect(
      normalizeHomeLayout({ left: ["chat", "gone", "chat"], right: ["threads", "chat"] }),
    ).toEqual({ left: ["chat"], right: ["threads"] });
  });

  it("moves a panel across, up and down, and hides and restores it", () => {
    const across = moveHomePanel(DEFAULT_HOME_LAYOUT, "deploys", "other-column");
    expect(across).toEqual({ left: ["threads"], right: ["chat", "deploys"] });
    expect(moveHomePanel(across, "deploys", "up").right).toEqual(["deploys", "chat"]);
    expect(moveHomePanel(across, "deploys", "down")).toBe(across);

    const hidden = moveHomePanel(across, "chat", "hide");
    expect(hiddenHomePanels(hidden)).toEqual(["chat", "log"]);
    expect(moveHomePanel(hidden, "log", "show")).toEqual({
      left: ["threads", "log"],
      right: ["deploys"],
    });
  });

  it("offers only the moves that do something", () => {
    expect([...homePanelMoves(DEFAULT_HOME_LAYOUT, "threads")].toSorted()).toEqual([
      "down",
      "hide",
      "other-column",
    ]);
    expect([...homePanelMoves(DEFAULT_HOME_LAYOUT, "log")]).toEqual(["show"]);
  });
});
