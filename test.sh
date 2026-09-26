#!/bin/sh
# bend-falsify's gate.
#
#   1. the fixture project checks: a file import and a directory import two
#      levels up, four laws, one of them with a premise
#   2. the tests pass: right mutants pass; each way a mutant can be wrong is
#      refused; the falsifier names a counterexample and passes a true law
#   3. the example (examples/plus0, the README's example) checks, and a broken
#      copy of its spec is refused
#   4. the mutant table's newer refusals: an instance the mutation does not
#      move, at without a binder's value, and an import that names nothing --
#      which is what a file import would look like unwired
#   5. the source typechecks
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

# A check that has never failed proves nothing. Break one claim in a copy and
# require it to be refused. The spec's imports are relative to the spec file,
# so a copy is enough -- no path rewriting.
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
sed 's/{C.plus0(3n) == 3n : Nat}/{C.plus0(3n) == 4n : Nat}/' "$TMP/bad-claim/spec.json" > "$TMP/s"
mv "$TMP/s" "$TMP/bad-claim/spec.json"
bun src/falsify.ts "$TMP/bad-claim/spec.json" | grep -q "COUNTEREXAMPLE plus0_three" || { echo "FAIL: a false instance was not refused"; exit 1; }
echo "  checks, and a broken spec is refused"

echo "== 4. the mutant table's refusals =="
# The fixture's table, as it stands, runs: its laws import a directory two
# levels up and a file one level up (`import ../shared.bend`), and the run has
# to mirror both into the scratch tree, or the counters read as false on the
# core itself.
bun src/falsify.ts mutants test/tree/group/proj | grep -q "PASS: all 4 mutants" || { echo "FAIL: the fixture's mutant table"; exit 1; }
echo "  a file import and a directory import are mirrored into the scratch tree"

# `double` is `Nat.mul(n, 2n)` mutated to `Nat.mul(n, 3n)`, and the two agree at
# n = 0: that instance is not a counterexample, and `at` must be refused.
cp -R test/tree "$TMP/tree-holds"
sed 's/"n": "1n"/"n": "0n"/' "$TMP/tree-holds/group/proj/mutants.json" > "$TMP/m"
mv "$TMP/m" "$TMP/tree-holds/group/proj/mutants.json"
bun src/falsify.ts mutants "$TMP/tree-holds/group/proj" | grep -q "still holds on the mutant" || { echo "FAIL: an instance the mutation does not move was not refused"; exit 1; }
echo "  an instance the mutation does not move is refused"

# `at` has to stand for every binder the law has.
cp -R test/tree "$TMP/tree-nobinder"
sed 's/"at": { "n": "1n" }/"at": { }/' "$TMP/tree-nobinder/group/proj/mutants.json" > "$TMP/m"
mv "$TMP/m" "$TMP/tree-nobinder/group/proj/mutants.json"
bun src/falsify.ts mutants "$TMP/tree-nobinder/group/proj" | grep -q 'at gives no value for the binder "n"' || { echo "FAIL: at with a binder left out was not refused"; exit 1; }
echo "  at with a binder left out is refused"

# An import that names nothing stops the run by name -- the file that makes it,
# and the import -- before any check runs.
cp -R test/tree "$TMP/tree-gone"
rm "$TMP/tree-gone/group/shared.bend"
bun src/falsify.ts mutants "$TMP/tree-gone/group/proj" 2>&1 | grep -q "core.bend: import ../shared.bend does not exist:" || { echo "FAIL: an import that names nothing was not reported"; exit 1; }
echo "  an import that names nothing is reported by name"

echo "== 5. the types =="
bunx tsc -p .

echo "PASS: bend-falsify's gate"
