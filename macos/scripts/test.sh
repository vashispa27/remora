#!/usr/bin/env bash
#
# Runs the RemoraCore unit tests.
#
# On a Command Line Tools-only machine, the Swift Testing framework lives outside the
# default search paths, and the generated test runner does not inherit flags declared
# in Package.swift. Passing the framework path to every swiftc invocation fixes both
# the test sources and the runner. When Xcode is installed these flags are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."

FRAMEWORKS="/Library/Developer/CommandLineTools/Library/Developer/Frameworks"
TEST_LIB="/Library/Developer/CommandLineTools/Library/Developer/usr/lib"

ARGS=()
if [ -d "${FRAMEWORKS}/Testing.framework" ]; then
  ARGS+=(
    -Xswiftc -F -Xswiftc "${FRAMEWORKS}"
    -Xlinker -rpath -Xlinker "${FRAMEWORKS}"
    -Xlinker -rpath -Xlinker "${TEST_LIB}"
  )
fi

exec swift test "${ARGS[@]}" "$@"
