#!/usr/bin/env bash
#
# Builds the Swift executable and assembles a launchable Remora.app bundle.
#
# Usage: ./scripts/build-app.sh [debug|release]
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIGURATION="${1:-debug}"

swift build -c "${CONFIGURATION}"
BIN_PATH="$(swift build -c "${CONFIGURATION}" --show-bin-path)"

APP_PATH="${PWD}/.build/Remora.app"
rm -rf "${APP_PATH}"
mkdir -p "${APP_PATH}/Contents/MacOS" "${APP_PATH}/Contents/Resources"

cp "${BIN_PATH}/Remora" "${APP_PATH}/Contents/MacOS/Remora"
cp scripts/Info.plist "${APP_PATH}/Contents/Info.plist"

# Ad-hoc signing keeps macOS from quarantining the local build.
codesign --force --sign - "${APP_PATH}" >/dev/null 2>&1 || true

echo "Built ${APP_PATH}"
echo "Run with: open \"${APP_PATH}\""
