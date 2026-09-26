#!/bin/sh
# bend-falsify's gate.
#
#   1. the fixture project checks: a file import and a directory import two
#      levels up, four laws, one of them with a premise
#   2. the tests pass: right mutants pass; each way a mutant can be wrong is
#      refused; a mutant that relaxes a law's premise is a counterexample all
#      the same; the falsifier names a counterexample and passes a true law
#   3. the example (examples/plus0, the README's example) checks, and a broken
#      copy of its spec is refused
#   4. the mutant table's newer refusals: an instance the mutation does not
#      move, at without a binder's value, an import that names nothing --
#      which is what a file import would look like unwired -- and two sections
#      under one header; and the fixture whose LAWS.bend aliases the core,
#      where an `at` row passes and a `counter` row still names the core `C`
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
# examples/plus0 is the project the README's snippets come from: four laws --
# one of them Bool-valued -- four mutants, one of them proved `with` another,
# and a spec. Its spec and its table both run here, so the README cannot
# describe a file that does not work.
(cd examples/plus0 && bend PROOF.bend | grep -q "All terms check.") || { echo "FAIL: the example does not check"; exit 1; }
bun src/falsify.ts examples/plus0/spec.json | grep -q "holds on all 3 instances" || { echo "FAIL: the example's spec"; exit 1; }
bun src/falsify.ts mutants examples/plus0 | grep -q "PASS: all 4 mutants" || { echo "FAIL: the example's mutant table"; exit 1; }

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
# core itself. Its last row is a mutant that relaxes the law's premise instead
# of falsifying its claim: the premise is false on the core there, so check 1
# is vacuous, and the run says so on the line.
bun src/falsify.ts mutants test/tree/group/proj > /tmp/bend-falsify-fixture.log 2>&1 || { cat /tmp/bend-falsify-fixture.log; echo "FAIL: the fixture's mutant table"; exit 1; }
grep -q "PASS: all 5 mutants" /tmp/bend-falsify-fixture.log || { echo "FAIL: the fixture's mutant table"; exit 1; }
grep -q "(premise false on the core)" /tmp/bend-falsify-fixture.log || { echo "FAIL: a premise-relaxing mutant was not reported as vacuous"; exit 1; }
echo "  a file import and a directory import are mirrored into the scratch tree"
echo "  a premise false on the core is reported, not refused"

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

# A law whose LAWS.bend imports the core under an alias other than C. An `at`
# instance is the law's statement as written, so the file it is checked in has
# to import the core under that alias -- a file that always said `C` would
# refuse the instance as a name that is not in scope. The fixture's second row
# is a hand-written `counter`, which names the core `C` whatever the laws call
# it, and says on its line that nothing ties it to the law.
bun src/falsify.ts mutants test/tree/aliased > /tmp/bend-falsify-aliased.log 2>&1 || { cat /tmp/bend-falsify-aliased.log; echo "FAIL: the fixture whose laws alias the core"; exit 1; }
grep -q "PASS: all 2 mutants" /tmp/bend-falsify-aliased.log || { cat /tmp/bend-falsify-aliased.log; echo "FAIL: the fixture whose laws alias the core"; exit 1; }
grep -q "(counter not tied to the law)" /tmp/bend-falsify-aliased.log || { cat /tmp/bend-falsify-aliased.log; echo "FAIL: a counter row did not say it is untied"; exit 1; }
echo "  an at instance is built under the alias LAWS.bend imports the core as"

# An import that names nothing stops the run by name -- the file that makes it,
# and the import -- before any check runs.
cp -R test/tree "$TMP/tree-gone"
rm "$TMP/tree-gone/group/shared.bend"
bun src/falsify.ts mutants "$TMP/tree-gone/group/proj" 2>&1 | grep -q "core.bend: import ../shared.bend does not exist:" || { echo "FAIL: an import that names nothing was not reported"; exit 1; }
echo "  an import that names nothing is reported by name"

# Two sections under one header would be kept together and their text
# concatenated, so the proof would break somewhere that names neither: the run
# stops by name and line, before any check.
cp -R test/tree "$TMP/tree-dup"
sed 's/^# ---- keep is the identity ----$/# ---- double adds ----/' "$TMP/tree-dup/group/proj/PROOF.bend" > "$TMP/p"
mv "$TMP/p" "$TMP/tree-dup/group/proj/PROOF.bend"
bun src/falsify.ts mutants "$TMP/tree-dup/group/proj" 2>&1 | grep -q 'duplicate section header "# ---- double adds ----"' || { echo "FAIL: two sections under one header were not refused"; exit 1; }
echo "  two sections under one header are refused by name and line"

echo "== 5. the types =="
bunx tsc -p .

echo "PASS: bend-falsify's gate"
