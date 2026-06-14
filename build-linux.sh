#!/usr/bin/env bash
#
# Mason Launcher - Linux build script
#
# Runs: typecheck -> lint -> test -> package/make, stopping on first failure.
#
# Usage:
#   ./build-linux.sh                 # Debug (expanded build under out/debug)
#   ./build-linux.sh debug           # same as above
#   ./build-linux.sh release         # Release artifacts under out/release
#   ./build-linux.sh release --skip-tests --skip-lint
#
set -euo pipefail

CONFIGURATION="debug"
SKIP_TESTS=0
SKIP_LINT=0
TARGET=""

for arg in "$@"; do
  case "$arg" in
    release|Release) CONFIGURATION="release" ;;
    debug|Debug)     CONFIGURATION="debug" ;;
    --skip-tests)    SKIP_TESTS=1 ;;
    --skip-lint)     SKIP_LINT=1 ;;
    --target=*)      TARGET="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Configuration selects the default target unless --target was given.
if [ -z "$TARGET" ]; then
  if [ "$CONFIGURATION" = "debug" ]; then TARGET="package"; else TARGET="make"; fi
fi

export MASON_BUILD_CONFIGURATION="$CONFIGURATION"
if [ "$CONFIGURATION" = "debug" ]; then export NODE_ENV="development"; else export NODE_ENV="production"; fi
OUTPUT_ROOT="out/$CONFIGURATION"

cd "$(dirname "$0")"

step_index=0
start_time=$(date +%s)

step() {
  step_index=$((step_index + 1))
  echo
  echo "[$step_index] $1"
  printf '%.0s-' {1..60}; echo
}

echo
echo "Mason Launcher - Build"
echo "Configuration : $CONFIGURATION"
echo "Target        : $TARGET"
echo "Output        : $OUTPUT_ROOT"
echo "Date          : $(date '+%Y-%m-%d %H:%M:%S')"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found." >&2
  exit 1
fi
node_major=$(node --version | sed -E 's/v([0-9]+).*/\1/')
if [ "$node_major" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found: $(node --version))" >&2
  exit 1
fi
echo "Node          : $(node --version)"

if [ ! -d node_modules ]; then
  step "npm install"
  npm install
fi

step "TypeScript typecheck"
npm run typecheck

if [ "$SKIP_LINT" -eq 0 ]; then
  step "ESLint"
  npm run lint
fi

if [ "$SKIP_TESTS" -eq 0 ]; then
  step "Tests (Node.js test runner)"
  npm run test
fi

case "$TARGET" in
  package)
    step "electron-forge package  ->  $OUTPUT_ROOT/"
    npm run package
    ;;
  make)
    step "electron-forge make  ->  $OUTPUT_ROOT/make/"
    npm run make
    ;;
  check)
    : # checks only, no build
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    exit 2
    ;;
esac

elapsed=$(( $(date +%s) - start_time ))
echo
printf '%.0s=' {1..60}; echo
echo "BUILD OK  ($CONFIGURATION, ${elapsed}s)"
echo
