import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ app: {} }));

import { newestReleaseAfter, type UpstreamRelease } from "./SelfBuildUpdater.ts";

const release = (tag: string, prerelease = tag.includes("nightly")): UpstreamRelease => ({
  tag_name: tag,
  prerelease,
  draft: false,
});

describe("newestReleaseAfter", () => {
  const releases = [
    release("v0.1.11-nightly.20261118.4877"),
    release("v0.1.11-nightly.20261118.4890"),
    release("v0.1.10"),
    release("v0.1.11-nightly.20261117.4851"),
    { ...release("v0.1.11-nightly.20261119.4900"), draft: true },
  ];

  it("offers the newest nightly after the running build", () => {
    expect(newestReleaseAfter(releases, "nightly", "0.1.11-nightly.20261117.4851")?.tag_name).toBe(
      "v0.1.11-nightly.20261118.4890",
    );
  });

  it("offers nothing when the running build is the newest", () => {
    expect(newestReleaseAfter(releases, "nightly", "0.1.11-nightly.20261118.4890")).toBeNull();
  });

  it("keeps the stable channel to stable releases", () => {
    expect(newestReleaseAfter(releases, "latest", "0.1.9")?.tag_name).toBe("v0.1.10");
  });
});
