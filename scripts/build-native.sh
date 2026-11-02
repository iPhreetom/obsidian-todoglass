#!/bin/bash
set -euo pipefail

task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_app="$task_root/dist/macos/TodoGlass.app"
task_temp="$(mktemp -d "${TMPDIR:-/tmp}/todoglass-native.XXXXXX")"
trap 'rm -rf "$task_temp"' EXIT

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The native helper must be built on macOS with Xcode Command Line Tools." >&2
  exit 1
fi
task_sdk="$(xcrun --show-sdk-path)"
mkdir -p "$task_app/Contents/MacOS" "$task_app/Contents/Resources"

for task_arch in arm64 x86_64; do
  echo "Building TodoGlass for ${task_arch}…"
  xcrun swiftc "$task_root/native/TodoGlass.swift" \
    -O -whole-module-optimization -swift-version 5 \
    -sdk "$task_sdk" -target "$task_arch-apple-macosx13.0" \
    -module-cache-path "$task_temp/module-cache-$task_arch" \
    -o "$task_temp/TodoGlass-$task_arch"
done

xcrun lipo -create "$task_temp/TodoGlass-arm64" "$task_temp/TodoGlass-x86_64" \
  -output "$task_app/Contents/MacOS/TodoGlass"
cp "$task_root/native/Info.plist" "$task_app/Contents/Info.plist"
if [[ -f "$task_root/native/panel.html" ]]; then
  cp "$task_root/native/panel.html" "$task_app/Contents/Resources/panel.html"
elif [[ "${TODOGLASS_SKIP_UI:-0}" != "1" ]]; then
  echo "Missing native/panel.html. Re-run after the panel UI is available." >&2
  exit 1
fi
chmod +x "$task_app/Contents/MacOS/TodoGlass"
codesign --force --sign - "$task_app" >/dev/null 2>&1
echo "Built universal helper: $task_app"
