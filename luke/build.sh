#!/bin/bash
# Builds, signs and notarizes "T3 Code (Luke)" from this checkout, then installs it (see install.sh).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/.t3-luke-build"
APP_NAME="T3 Code (Luke)"
APP_ID="com.lukefornieri.t3code"
export PATH="$REPO/node_modules/.bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$REPO"
TAG="$(git describe --tags --match 'v*-nightly.*' --abbrev=0)"
VERSION="${TAG#v}"
IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/ && !found { print $2; found = 1 }')"
[ -n "$IDENTITY" ] || { echo "No Developer ID Application certificate found" >&2; exit 1; }
set -a
# shellcheck source=/dev/null
. "$HOME/.appstoreconnect/asc.env"
# shellcheck source=build.env
. "$REPO/luke/build.env"
set +a
NOTARY_KEY="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"

npx -y pnpm@12.14.0 install --frozen-lockfile

rm -rf "$WORK/out" "$WORK/stage"
mkdir -p "$WORK/stage"
T3CODE_DESKTOP_PRODUCT_NAME="$APP_NAME" T3CODE_DESKTOP_APP_ID="$APP_ID" \
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 \
  --build-version "$VERSION" --output-dir "$WORK/out"

ditto -x -k "$WORK/out/T3-Code-$VERSION-arm64.zip" "$WORK/stage"
APP="$WORK/stage/$APP_NAME.app"
node "$REPO/luke/sign.mjs" "$APP" "$IDENTITY" "$REPO/luke/entitlements.mac.plist"
codesign --verify --deep --strict "$APP"

ditto -c -k --keepParent "$APP" "$WORK/stage/notarize.zip"
xcrun notarytool submit "$WORK/stage/notarize.zip" \
  --key "$NOTARY_KEY" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" --wait \
  | tee "$WORK/stage/notary.log"
grep -q "status: Accepted" "$WORK/stage/notary.log"
xcrun stapler staple "$APP"
spctl --assess --type execute "$APP"

# Hand the app to the installer, which swaps it in once the app isn't running.
rm -rf "$WORK/ready"
mkdir -p "$WORK/ready"
mv "$APP" "$WORK/ready/"
git rev-parse HEAD > "$WORK/ready/commit"
echo "$VERSION" > "$WORK/ready/version"
rm -rf "$WORK/out" "$WORK/stage"
"$REPO/luke/install.sh"
