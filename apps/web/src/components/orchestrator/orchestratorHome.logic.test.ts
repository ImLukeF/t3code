import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  describeLatestActivity,
  formatHomeTimer,
  homeThreadKey,
  resolveOrchestratorThread,
  selectHomeThreadRows,
  selectDeployQueue,
  selectShipEvents,
  selectShippedToday,
  shipRequestText,
} from "./orchestratorHome.logic";

const items = (...list: ReadonlyArray<Record<string, unknown>>) =>
  list.map((item) => ({ item })) as unknown as ReadonlyArray<OrchestrationV2ProjectedTurnItem>;

function thread(id: string, overrides: Partial<EnvironmentThreadShell> = {}) {
  return {
    environmentId: "env",
    id,
    projectId: "project",
    title: id,
    lineage: { relationshipToParent: null, parentThreadId: null },
    delegatedFrom: null,
    archivedAt: null,
    deletedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    updatedAt: "2026-01-01T10:00:00.000Z",
    latestRun: null,
    runtime: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pullRequests: [],
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

const running = { status: "running", activeRunId: "run" } as EnvironmentThreadShell["runtime"];
const NOW = Date.parse("2026-01-01T12:00:00.000Z");

describe("describeLatestActivity", () => {
  it.each([
    {
      item: { type: "command_execution", input: "git status\n" },
      stage: "terminal",
      line: "$ git status",
    },
    {
      item: { type: "command_execution", input: "vp test run" },
      stage: "checks",
      line: "$ vp test run",
    },
    {
      item: { type: "file_change", fileName: "src/lib/math.ts" },
      stage: "code",
      line: "Editing math.ts",
    },
    {
      item: { type: "reasoning", text: "First.\n\n**Reading the routes**" },
      stage: "thinking",
      line: "Reading the routes",
    },
  ])("reads $stage from the newest item", ({ item, stage, line }) => {
    expect(describeLatestActivity(items({ type: "assistant_message", text: "old" }, item))).toEqual(
      { stage, line },
    );
  });

  it("skips items that say nothing and stops at the prompt", () => {
    expect(
      describeLatestActivity(
        items({ type: "file_change", fileName: "a.ts" }, { type: "checkpoint" }),
      )?.stage,
    ).toBe("code");
    expect(
      describeLatestActivity(
        items({ type: "file_change", fileName: "a.ts" }, { type: "user_message", text: "go" }),
      ),
    ).toBeNull();
  });
});

describe("resolveOrchestratorThread", () => {
  const projects = [{ environmentId: "env", id: "orch", title: "T3 Orchestrator" }] as never;
  const plain = thread("plain");
  const pinned = thread("pinned", { pinnedAt: "2026-01-01T00:00:00.000Z" });
  const inProject = thread("in-project", { projectId: "orch" as never });

  it("prefers the chosen thread, then a pinned one, then one named for the job", () => {
    const all = [plain, inProject, pinned];
    expect(resolveOrchestratorThread(all, projects, homeThreadKey(plain))).toBe(plain);
    expect(resolveOrchestratorThread(all, projects, "")).toBe(pinned);
    expect(resolveOrchestratorThread([plain, inProject], projects, "")).toBe(inProject);
    expect(resolveOrchestratorThread([plain], projects, "")).toBeNull();
  });

  it("falls back when the chosen thread is archived", () => {
    const archived = thread("gone", { archivedAt: "2026-01-01T00:00:00.000Z" });
    expect(resolveOrchestratorThread([archived, pinned], projects, homeThreadKey(archived))).toBe(
      pinned,
    );
  });
});

describe("selectHomeThreadRows", () => {
  it("lists what needs you first, hides the orchestrator and drops stale quiet threads", () => {
    const orchestrator = thread("orchestrator", { runtime: running });
    const rows = selectHomeThreadRows(
      [
        thread("quiet"),
        thread("stale", { updatedAt: "2025-12-01T00:00:00.000Z" }),
        thread("busy", { runtime: running }),
        thread("asking", { runtime: running, hasPendingApprovals: true }),
        orchestrator,
      ],
      homeThreadKey(orchestrator),
      NOW,
    );
    expect(rows.map((row) => [row.thread.id, row.state])).toEqual([
      ["asking", "needs-you"],
      ["busy", "busy"],
      ["quiet", "quiet"],
    ]);
  });
});

describe("formatHomeTimer", () => {
  it("pads minutes and adds hours once past one", () => {
    expect(formatHomeTimer(48_000)).toBe("00:48");
    expect(formatHomeTimer(3_725_000)).toBe("1:02:05");
  });
});

describe("deploy queue", () => {
  const pr = (number: number, snapshot: Record<string, unknown>) => ({
    number,
    url: `https://example.invalid/pr/${number}`,
    snapshot: { title: `PR ${number}`, isDraft: false, updatedAt: null, ...snapshot },
  });
  const withPr = (id: string, snapshot: Record<string, unknown>) =>
    thread(id, { pullRequests: [pr(1, snapshot)] as never });
  const link = (id: string) => `[${id}](t3-thread://v2/env/${id})`;
  const message = (type: string, text: string, at: number) => ({
    type,
    text,
    startedAt: null,
    updatedAt: DateTime.makeUnsafe(at),
  });

  it("reads requests and update lines from the chat, and nothing else", () => {
    const asked = thread("asked");
    const events = selectShipEvents(
      items(
        message("user_message", `please look at ${link("asked")}, it is live`, 1),
        message("user_message", shipRequestText(asked), 10),
        message(
          "assistant_message",
          [
            `On it. Ship update: ${link("asked")} live`,
            `- Ship update: ${link("asked")} merged`,
            `Ship update: [failed deploy fix](t3-thread://v2/env/other) deploying`,
            `Ship update: ${link("asked")} soon`,
          ].join("\n"),
          20,
        ),
      ),
      "env" as never,
    );
    expect(events).toEqual([
      { threadKey: homeThreadKey(asked), status: "requested", at: 10 },
      { threadKey: homeThreadKey(asked), status: "merged", at: 20 },
      { threadKey: homeThreadKey(thread("other")), status: "deploying", at: 20 },
    ]);
  });

  it("shows each thread at its newest step, and pull requests where nothing was recorded", () => {
    const key = (id: string) => homeThreadKey(thread(id));
    const queue = selectDeployQueue(
      [
        withPr("conflict", { state: "open", mergeability: "conflicting" }),
        withPr("pending", { state: "open", checksState: "passing" }),
        withPr("old-merge", { state: "merged", mergedAt: "2025-12-01T00:00:00.000Z" }),
        withPr("shipped", { state: "merged", mergedAt: "2026-01-01T11:00:00.000Z" }),
        thread("requested"),
        thread("no-pr"),
      ],
      [
        { threadKey: key("requested"), status: "requested", at: NOW - 60_000 },
        { threadKey: key("shipped"), status: "requested", at: NOW - 4 * 3_600_000 },
        { threadKey: key("shipped"), status: "deploying", at: NOW - 1_800_000 },
        { threadKey: key("shipped"), status: "live", at: NOW - 600_000 },
      ],
      NOW,
    );
    expect(queue.map((entry) => [entry.thread.id, entry.status])).toEqual([
      ["requested", "requested"],
      ["pending", "pending"],
      ["conflict", "blocked"],
      ["shipped", "live"],
    ]);
    const live = queue.at(-1);
    expect(live === undefined ? null : live.at - live.startedAt).toBe(4 * 3_600_000 - 600_000);
  });

  it("counts a thread as shipped today for a merge or a recorded live deploy", () => {
    const merged = withPr("merged", { state: "merged", mergedAt: "2026-01-01T11:00:00.000Z" });
    const live = thread("live");
    const shipped = selectShippedToday(
      [merged, live, thread("neither")],
      [{ threadKey: homeThreadKey(live), status: "live", at: NOW - 1000 }],
      NOW,
    );
    expect(shipped).toEqual([merged, live]);
  });
});
