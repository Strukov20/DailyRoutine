#!/usr/bin/env bash
# Runs the Maestro flows under .maestro/ against the iOS Simulator.
#
# Prerequisites (not automated here — see docs/DECISIONS.md, "Phase 5"):
#   - Metro + the app running on an iOS Simulator (npx expo run:ios).
#   - Local Supabase stack running (npm run supabase:start) with a fresh
#     `npm run db:reset` and `npm run e2e:seed` — the latter writes
#     .maestro/.env.local, which this script reads member IDs from.
#   - Maestro CLI installed user-scoped (curl -Ls "https://get.maestro.mobile.dev" | bash)
#     and a JDK (brew install openjdk) — no sudo for either.
#
# Usage: npm run e2e:ios [-- <flow file>...]
# With no arguments, runs every flow under .maestro/.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v maestro >/dev/null 2>&1; then
  export PATH="$HOME/.maestro/bin:$PATH"
fi

# macOS ships a /usr/bin/java stub that exists on PATH but errors out
# with no real JDK installed, so `command -v java` alone can't tell us
# anything - always point JAVA_HOME at the Homebrew-installed JDK
# (brew install openjdk, no sudo) unless the caller already set one.
if [ -z "${JAVA_HOME:-}" ]; then
  OPENJDK_PREFIX="$(brew --prefix openjdk 2>/dev/null || true)"
  if [ -n "$OPENJDK_PREFIX" ] && [ -d "$OPENJDK_PREFIX/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="$OPENJDK_PREFIX/libexec/openjdk.jdk/Contents/Home"
  else
    echo "No JAVA_HOME set and no Homebrew openjdk formula detected." >&2
    echo "Install with: brew install openjdk (no sudo required)." >&2
    exit 1
  fi
fi

# Attempt at animation stabilization: enable Reduce Motion on the booted
# Simulator before every run. Maestro itself has no built-in option for
# this (checked its bundled jars directly - no ReduceMotion/animation-drag
# strings anywhere), so this is done at the Simulator level via simctl.
# Best-effort and non-fatal if no Simulator is booted yet or the write
# fails - this is a genuine attempt at reducing flakiness, not a proven
# fix (the tap-delivery issue documented in docs/DECISIONS.md, "Phase 5"
# was root-caused to touch delivery, not an animation race, so this alone
# is not expected to eliminate it - see that entry for the honest,
# measured reliability numbers with this enabled).
BOOTED_UDID="$(xcrun simctl list devices 2>/dev/null | grep -m1 '(Booted)' | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' || true)"
if [ -n "$BOOTED_UDID" ]; then
  xcrun simctl spawn "$BOOTED_UDID" defaults write com.apple.Accessibility ReduceMotionEnabled -bool YES 2>/dev/null || true
fi

ENV_ARGS=()
if [ -f .maestro/.env.local ]; then
  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    case "$key" in \#*) continue ;; esac
    ENV_ARGS+=(-e "$key=$value")
  done < .maestro/.env.local
else
  echo "No .maestro/.env.local found — run 'npm run e2e:seed' first." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  exec maestro test "${ENV_ARGS[@]}" "$@"
else
  exec maestro test "${ENV_ARGS[@]}" .maestro/
fi
