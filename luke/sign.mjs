// Signs every binary in the app with a Developer ID and the hardened runtime, ready to notarize.
// Usage: node luke/sign.mjs <app> <identity> <entitlements>
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const [app, identity, entitlements] = process.argv.slice(2);
if (!app || !identity || !entitlements) {
  throw new Error("Usage: node luke/sign.mjs <app> <identity> <entitlements>");
}

// The build scripts package owns @electron/osx-sign.
const require = NodeModule.createRequire(
  NodePath.resolve(import.meta.dirname, "../scripts/package.json"),
);
const { sign } = require("@electron/osx-sign");

await sign({
  app,
  identity,
  platform: "darwin",
  type: "distribution",
  preAutoEntitlements: false,
  batchCodesignCalls: true,
  optionsForFile: () => ({ hardenedRuntime: true, entitlements }),
});
