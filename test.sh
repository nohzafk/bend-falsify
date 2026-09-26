#!/bin/sh
# bend-falsify's gate.
#
#   1. the fixture project checks: an import two levels up, two laws
#   2. the tests pass: right mutants pass; each way a mutant can be wrong is
#      refused; the falsifier names a counterexample and passes a true law
#   3. the source typechecks
#
# Usage: sh test.sh

set -e
cd "$(dirname "$0")"

# The installed compiler, wherever it is.
PATH="$HOME/.bend/bin:$PATH"
export PATH
BEND_NO_TELEMETRY=1
export BEND_NO_TELEMETRY

echo "== 1. the fixture =="
(cd test/tree/group/proj && bend PROOF.bend | grep -q "All terms check.") || { echo "FAIL: the fixture does not check"; exit 1; }
echo "  checks"

echo "== 2. the tests =="
if ! bun test > /tmp/bend-falsify-tests.log 2>&1; then
  tail -30 /tmp/bend-falsify-tests.log
  echo "FAIL: a test failed"
  exit 1
fi
tail -3 /tmp/bend-falsify-tests.log

echo "== 3. the types =="
bunx tsc -p .

echo "PASS: bend-falsify's gate"
