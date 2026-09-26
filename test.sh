#!/bin/sh
# bend-falsify's gate.
#
#   1. the fixture project checks: an import two levels up, two laws
#   2. the tests pass: right mutants pass; each way a mutant can be wrong is
#      refused; the falsifier names a counterexample and passes a true law
#   3. the example (examples/plus0, the README's example) checks, and a broken
#      copy of its spec and of its table is refused
#   4. the source typechecks
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

echo "== 3. the example =="
# examples/plus0 is the project the README's snippets come from: three laws,
# three mutants, one of them proved `with` another, and a spec. Its spec and
# its table both run here, so the README cannot describe a file that does not
# work.
(cd examples/plus0 && bend PROOF.bend | grep -q "All terms check.") || { echo "FAIL: the example does not check"; exit 1; }
bun src/falsify.ts examples/plus0/spec.json | grep -q "holds on all 3 instances" || { echo "FAIL: the example's spec"; exit 1; }
bun src/falsify.ts mutants examples/plus0 | grep -q "PASS: all 3 mutants" || { echo "FAIL: the example's mutant table"; exit 1; }

# A check that has never failed proves nothing. Break one claim and one
# counter in copies and require each to be refused. The spec's imports are
# relative to the spec file, so a copy is enough -- no path rewriting.
#
# The copy must not sit under a directory whose name holds a dot: the spec
# turns "./core.bend" into an absolute path, and bend refuses an import path
# that is not plain names (letters, digits, _ and -). So no `mktemp -d`, whose
# suffix is `tmp.XXXXXX`.
TMP=/tmp/bend-falsify-gate-$$
rm -rf "$TMP"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
cp -R examples/plus0 "$TMP/bad-claim"
cp -R examples/plus0 "$TMP/bad-counter"
sed 's/{C.plus0(3n) == 3n : Nat}/{C.plus0(3n) == 4n : Nat}/' "$TMP/bad-claim/spec.json" > "$TMP/s"
mv "$TMP/s" "$TMP/bad-claim/spec.json"
sed 's/{C.plus0(0n) == 0n : Nat}/{C.plus0(0n) == 1n : Nat}/' "$TMP/bad-counter/mutants.json" > "$TMP/m"
mv "$TMP/m" "$TMP/bad-counter/mutants.json"
bun src/falsify.ts "$TMP/bad-claim/spec.json" | grep -q "COUNTEREXAMPLE plus0_three" || { echo "FAIL: a false instance was not refused"; exit 1; }
bun src/falsify.ts mutants "$TMP/bad-counter" | grep -q "the counterexample is false on the core itself" || { echo "FAIL: a bad counter was not refused"; exit 1; }
echo "  checks, and a broken spec and table are refused"

echo "== 4. the types =="
bunx tsc -p .

echo "PASS: bend-falsify's gate"
