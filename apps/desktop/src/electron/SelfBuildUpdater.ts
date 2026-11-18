// @effect-diagnostics nodeBuiltinImport:off globalFetch:off effectFnOpportunity:off -- Stands in for electron-updater, which is promise and event based too.
/**
 * SelfBuildUpdater - stands in for electron-updater in a personal build: a check finds a newer
 * official release, "download" runs update.sh to rebuild on it, install swaps the app and reopens.
 *
 * @module SelfBuildUpdater
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Electron from "electron";

import {
  ElectronUpdater,
  ElectronUpdaterCheckForUpdatesError,
  ElectronUpdaterDownloadUpdateError,
  ElectronUpdaterQuitAndInstallError,
} from "./ElectronUpdater.ts";

declare const __T3CODE_BUILD_SELF_UPDATE_DIR__: string | undefined;

/** The folder holding the build's update.sh and install.sh; empty for official builds. */
export const selfUpdateDir =
  typeof __T3CODE_BUILD_SELF_UPDATE_DIR__ === "undefined" ? "" : __T3CODE_BUILD_SELF_UPDATE_DIR__;

const RELEASES_URL = "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=20";
const BUILD_DIR = NodePath.join(NodeOS.homedir(), ".t3-luke-build");
const READY_VERSION_FILE = NodePath.join(BUILD_DIR, "ready", "version");
const SCRIPT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export interface UpstreamRelease {
  readonly tag_name: string;
  readonly name?: string | null;
  readonly published_at?: string | null;
  readonly prerelease: boolean;
  readonly draft: boolean;
}

/** The newest release on the channel that is newer than `currentVersion`, if any. */
export function newestReleaseAfter(
  releases: ReadonlyArray<UpstreamRelease>,
  channel: string,
  currentVersion: string,
): UpstreamRelease | null {
  let newest: UpstreamRelease | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const version = release.tag_name.replace(/^v/u, "");
    const isNightly = version.includes("-nightly.");
    if (channel === "nightly" ? !isNightly : release.prerelease || isNightly) continue;
    if (compareSemverVersions(version, currentVersion) <= 0) continue;
    if (newest === null || compareSemverVersions(version, newest.tag_name.replace(/^v/u, "")) > 0) {
      newest = release;
    }
  }
  return newest;
}

// Build steps in update.sh output, as rough progress for the update button.
const PROGRESS_MARKERS: ReadonlyArray<readonly [RegExp, number]> = [
  [/Rebasing|Successfully rebased|HEAD -> luke/u, 5],
  [/Lockfile is up to date|Done in/u, 10],
  [/Building desktop\/server\/web artifacts/u, 15],
  [/Building mac\/dmg/u, 35],
  [/Done\. Artifacts/u, 55],
  [/Submission ID received/u, 65],
  [/status: Accepted/u, 90],
  [/staple and validate action worked/u, 95],
];

const readReadyVersion = () => {
  try {
    return NodeFS.readFileSync(READY_VERSION_FILE, "utf8").trim();
  } catch {
    return "";
  }
};

const scriptEnv = () => ({
  HOME: NodeOS.homedir(),
  USER: NodeOS.userInfo().username,
  PATH: SCRIPT_PATH,
  LANG: "en_US.UTF-8",
  // The app shows progress and asks to restart itself, so the scripts skip their notifications.
  T3CODE_LUKE_FROM_APP: "1",
});

const make = (dir: string) => {
  const events = new NodeEvents.EventEmitter();
  let channel = "nightly";
  let offeredVersion: string | null = null;

  const check = async () => {
    events.emit("checking-for-update");
    const response = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "t3code-self-build" },
    });
    if (!response.ok) throw new Error(`GitHub releases returned ${response.status}.`);
    const releases = (await response.json()) as ReadonlyArray<UpstreamRelease>;
    const release = newestReleaseAfter(releases, channel, Electron.app.getVersion());
    if (release === null) {
      offeredVersion = null;
      events.emit("update-not-available");
      return;
    }
    offeredVersion = release.tag_name.replace(/^v/u, "");
    events.emit("update-available", {
      version: offeredVersion,
      releaseName: release.name ?? null,
      ...(release.published_at ? { releaseDate: release.published_at } : {}),
    });
  };

  const build = () =>
    new Promise<string>((resolve, reject) => {
      const target = offeredVersion;
      if (target === null) {
        reject(new Error("No update to build."));
        return;
      }
      // A build the daily job already finished only needs installing.
      if (readReadyVersion() === target) {
        resolve(target);
        return;
      }
      const child = NodeChildProcess.spawn(
        "/bin/bash",
        [NodePath.join(dir, "update.sh"), "--force"],
        {
          cwd: dir,
          env: scriptEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const log = NodeFS.createWriteStream(NodePath.join(BUILD_DIR, "update.log"), { flags: "a" });
      let percent = 0;
      let tail = "";
      const onOutput = (chunk: Buffer) => {
        log.write(chunk);
        const text = chunk.toString("utf8");
        tail = (tail + text).slice(-2000);
        for (const [marker, value] of PROGRESS_MARKERS) {
          if (value > percent && marker.test(text)) percent = value;
        }
        events.emit("download-progress", { percent });
      };
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);
      child.on("error", reject);
      child.on("close", (code) => {
        log.end();
        const built = readReadyVersion();
        if (code === 0 && built !== "") {
          resolve(built);
          return;
        }
        const lastLines = tail.trim().split("\n").slice(-6).join("\n");
        reject(new Error(`The rebuild failed (exit ${code}). ${lastLines}`));
      });
    });

  return ElectronUpdater.of({
    setFeedURL: () => Effect.void,
    setAutoDownload: () => Effect.void,
    setAutoInstallOnAppQuit: () => Effect.void,
    setChannel: (value) =>
      Effect.sync(() => {
        channel = value;
      }),
    setAllowPrerelease: () => Effect.void,
    allowDowngrade: Effect.succeed(false),
    setAllowDowngrade: () => Effect.void,
    setFullChangelog: () => Effect.void,
    setDisableDifferentialDownload: () => Effect.void,
    checkForUpdates: Effect.tryPromise({
      try: check,
      catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel, cause }),
    }),
    downloadUpdate: Effect.tryPromise({
      try: async () => {
        const version = await build();
        events.emit("download-progress", { percent: 100 });
        events.emit("update-downloaded", { version });
      },
      catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel, cause }),
    }),
    quitAndInstall: ({ isSilent, isForceRunAfter }) =>
      Effect.try({
        try: () => {
          // Waits for this app to exit, installs the new build, then opens it again.
          const helper = NodeChildProcess.spawn(
            "/bin/bash",
            [
              "-c",
              'while kill -0 "$1" 2>/dev/null; do sleep 1; done; ' +
                'for _ in 1 2 3 4 5 6 7 8 9 10; do "$2/install.sh"; [ -d "$3/ready" ] || break; sleep 3; done; ' +
                'open "$4"',
              "t3-self-install",
              String(process.pid),
              dir,
              BUILD_DIR,
              NodePath.resolve(Electron.app.getPath("exe"), "../../.."),
            ],
            { detached: true, stdio: "ignore", env: scriptEnv() },
          );
          helper.unref();
          Electron.app.quit();
        },
        catch: (cause) =>
          new ElectronUpdaterQuitAndInstallError({ channel, isSilent, isForceRunAfter, cause }),
      }),
    on: (eventName, listener) => {
      const untyped = listener as unknown as (...args: Array<unknown>) => void;
      return Effect.acquireRelease(
        Effect.sync(() => {
          events.on(eventName, untyped);
        }),
        () =>
          Effect.sync(() => {
            events.removeListener(eventName, untyped);
          }),
      ).pipe(Effect.asVoid);
    },
  });
};

export const layer = Layer.sync(ElectronUpdater, () => make(selfUpdateDir));
