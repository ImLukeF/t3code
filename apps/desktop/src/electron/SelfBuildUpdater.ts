// @effect-diagnostics nodeBuiltinImport:off effectFnOpportunity:off -- Stands in for electron-updater, which is promise and event based too.
/**
 * SelfBuildUpdater - stands in for electron-updater in a personal build: update.sh rebuilds each
 * new official release in the background, a check offers that build, install swaps it in and reopens.
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

const BUILD_DIR = NodePath.join(NodeOS.homedir(), ".t3-luke-build");
const READY_VERSION_FILE = NodePath.join(BUILD_DIR, "ready", "version");
const SCRIPT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

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
  // The app asks to restart itself, so install.sh skips its notifications.
  T3CODE_LUKE_FROM_APP: "1",
});

const make = (dir: string) => {
  const events = new NodeEvents.EventEmitter();
  let channel = "nightly";
  let offeredVersion: string | null = null;

  // update.sh rebuilds each new Nightly in the background; an update is offered once it's built.
  const check = async () => {
    events.emit("checking-for-update");
    const ready = readReadyVersion();
    if (ready === "" || compareSemverVersions(ready, Electron.app.getVersion()) <= 0) {
      offeredVersion = null;
      events.emit("update-not-available");
      return;
    }
    offeredVersion = ready;
    events.emit("update-available", { version: ready, releaseName: null });
  };

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
        const version = readReadyVersion();
        if (offeredVersion === null || version !== offeredVersion) {
          throw new Error(
            "The new build is no longer waiting to install. Check for updates again.",
          );
        }
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
