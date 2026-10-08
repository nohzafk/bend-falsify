import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Law, counterImports, duplicateSections, importSites, instanceDefName, instanceHead, lawInstance, missingImports, mutate, placeProject, readLaw, relativeImports, substitute } from "../src/mutants.ts";

const run = (file: string, ...args: string[]) => {
  const r = Bun.spawnSync(["bun", `${import.meta.dir}/${file}`, ...args]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("outward imports: a directory, and a file, at any depth", () => {
  const r = relativeImports(["import Base\nimport ./core.bend as C\nimport ../base-facts/a.bend as A\n", "import ../../bend-schema/core/core.bend as S\nimport ../shared.bend as H\n"]);
  expect(r.paths.sort()).toEqual(["../../bend-schema", "../base-facts", "../shared.bend"]);
  expect(r.depth).toBe(2);
  expect(relativeImports(["import ./core.bend as C\n"]).depth).toBe(1);
});

test("an import is kept with the file that makes it", () => {
  expect(importSites([["core.bend", "import ../shared.bend as S\n"], ["LAWS.bend", "import ../../lib/facts.bend as F\nimport ../shared.bend as S\n"]]))
    .toEqual([{ file: "core.bend", rel: "../shared.bend" }, { file: "LAWS.bend", rel: "../../lib" }]);
});

test("an import that names nothing on disk is reported, with the file that makes it", () => {
  const dir = import.meta.dir + "/tree/group/proj";
  const sites = importSites([["core.bend", "import ../shared.bend as S\nimport ../gone.bend as G\n"]]);
  expect(missingImports(dir, sites)).toEqual([{ file: "core.bend", rel: "../gone.bend", abs: `${import.meta.dir}/tree/group/gone.bend` }]);
});

test("the project sits under its real ancestors, deep enough for every import", () => {
  expect(placeProject("/tmp/r", "/home/u/projects/app/lib", 2)).toBe("/tmp/r/projects/app/lib");
  expect(placeProject("/tmp/r", "/home/u/projects/app/lib", 1)).toBe("/tmp/r/app/lib");
  expect(() => placeProject("/tmp/r", "/a", 3)).toThrow("past the filesystem root");
});

test("the counterexample file imports the core as C and the laws' other imports", () => {
  const h = counterImports("import Base\nimport ./core.bend as Core\nimport ../../s/core.bend as S\n\nlaw x:\n");
  expect(h).toBe("import Base\nimport ./core.bend as C\nimport ../../s/core.bend as S");
  // a `counter` names the core `C` whatever the laws call it: the alias the
  // laws chose is not carried over, which is what makes the two kinds of
  // counterexample differ
  expect(counterImports("import Base\nimport ./core.bend as Core\n")).toBe("import Base\nimport ./core.bend as C");
});

test("an at instance's file is LAWS.bend itself, with every law removed", () => {
  const laws = `import Base
import ./core.bend as Core
import ../../s/core.bend as S

# a def of the laws' own, which the instance file has to bring in
def Q() -> Type: Nat

law plus0_same:
  for n: Nat
  {Core.plus0(n) == n : Q()}

# the next one
law other:
  for n: Nat
  {Core.plus0(n) == n : Nat}
`;
  const head = instanceHead(laws);
  // the imports stay, under the laws' own alias -- so an instance written the
  // way the law is written is in scope
  expect(head).toContain("import ./core.bend as Core");
  expect(head).toContain("import ../../s/core.bend as S");
  // and so do the laws' defs, which a claim or a premise may be typed by
  expect(head).toContain("def Q() -> Type: Nat");
  // every law is gone: a law is not a name an instance can use
  expect(head).not.toContain("law plus0_same");
  expect(head).not.toContain("law other");
  expect(instanceDefName(head)).toBe("counter");
});

test("the instance def's name steps aside for a def LAWS.bend declares", () => {
  expect(instanceDefName("import Base\nimport ./core.bend as C\n")).toBe("counter");
  expect(instanceDefName("def counter() -> Type: Nat\n")).toBe("counter_");
  expect(instanceDefName("def counter_() -> Type: Nat\ndef counter() -> Type: Nat\n")).toBe("counter__");
  // a longer name is a different name
  expect(instanceDefName("def counters() -> Type: Nat\n")).toBe("counter");
});

test("an at instance is checked in the laws' own file, defs and all", () => {
  const r = run("../src/falsify.ts", "mutants", `${import.meta.dir}/tree/named`);
  expect(r.out).toContain("PASS: all 2 mutants");
  expect(r.code).toBe(0);
});

test("an at instance is built under the alias LAWS.bend uses", () => {
  const r = run("../src/falsify.ts", "mutants", `${import.meta.dir}/tree/aliased`);
  expect(r.out).toContain("PASS: all 2 mutants");
  // the second row is hand-written, and names the core `C` whatever the laws
  // call it: its line says it is not tied to the law
  expect(r.out).toContain("(counter not tied to the law)");
  expect(r.code).toBe(0);
});

test("a mutation replaces exactly one whole line, or refuses", () => {
  expect(mutate("a\nb\nc", "b", "x", "L")).toBe("a\nx\nc");
  expect(() => mutate("a\nb", "z", "x", "L")).toThrow("not in core.bend");
  expect(() => mutate("b\nb", "b", "x", "L")).toThrow("occurs 2 times");
  expect(mutate("b\nb", "b", "x", "L", 2)).toBe("b\nx");
  expect(() => mutate("b\nb", "b", "x", "L", 3)).toThrow("nth 3");
});

const LAWS = `import Base
import ./core.bend as C

law double_adds:
  for n: Nat
  {C.double(n) == Nat.mul(n, 2n) : Nat}

law covered:
  for ~rule: Nat -> C.Raw -> Maybe<&2, C.Err>
  for +s: C.Schema
  for -tag: Nat
  for h: {C.check(~rule, s, tag) == Some{C.Err{tag}} : Bool}
  {C.defect(~rule, s, tag) == tag : Nat}

law uses_premise:
  for +s: C.Schema
  for h: {C.check(~C.no_rule, s, 1n) == Some{C.Err{0n}} : Bool}
  {C.defect(~C.no_rule, s, 1n) == h : Nat}
`;

test("a law is read as its binders -- marks, premises and all -- and its claim", () => {
  const law = readLaw(LAWS, "covered");
  expect(law.binders).toEqual([
    { name: "rule", mark: "~", type: "Nat -> C.Raw -> Maybe<&2, C.Err>", premise: false },
    { name: "s", mark: "+", type: "C.Schema", premise: false },
    { name: "tag", mark: "-", type: "Nat", premise: false },
    { name: "h", mark: "", type: "{C.check(~rule, s, tag) == Some{C.Err{tag}} : Bool}", premise: true },
  ]);
  expect(law.claim).toBe("{C.defect(~rule, s, tag) == tag : Nat}");
  expect(readLaw(LAWS, "double_adds").claim).toBe("{C.double(n) == Nat.mul(n, 2n) : Nat}");
  expect(() => readLaw(LAWS, "nope")).toThrow('no law "nope" in LAWS.bend');
});

test("a value stands in for a binder's name, and nothing else", () => {
  const law: Law = readLaw(LAWS, "double_adds");
  expect(lawInstance(law, { n: "3n" }).claim).toBe("{C.double(3n) == Nat.mul(3n, 2n) : Nat}");
  // the mark is not part of the name: it stays where the claim puts it
  expect(lawInstance(readLaw(LAWS, "covered"), { rule: "C.no_rule", s: "C.SNat{}", tag: "1n" }).claim)
    .toBe("{C.defect(~C.no_rule, C.SNat{}, 1n) == 1n : Nat}");
  // a name inside a string literal, or inside a longer word, is not a binder
  expect(substitute('{C.RStr{"n"} == C.n2 : Bool}', { n: "9n" })).toBe('{C.RStr{"n"} == C.n2 : Bool}');
});

test("an instance says which binder it could not stand for", () => {
  const law = readLaw(LAWS, "double_adds");
  expect(() => lawInstance(law, {})).toThrow('at gives no value for the binder "n" of double_adds');
  expect(() => lawInstance(law, { n: "1n", m: "0n" })).toThrow('at names "m", which the law double_adds does not bind');
  const covered = readLaw(LAWS, "covered");
  // a claim that reads a premise's proof term is a law `at` cannot state: there
  // is no value to put there, and `counter` is the fallback
  expect(() => lawInstance(readLaw(LAWS, "uses_premise"), { s: "C.SNat{}" }))
    .toThrow('the claim of uses_premise mentions "h", and at gives no value for it');
  // a premise is instantiated from the binders it reads, and needs no value of its own
  expect(lawInstance(covered, { rule: "C.no_rule", s: "C.SNat{}", tag: "1n" }).premises)
    .toEqual([{ binder: "h", equation: "{C.check(~C.no_rule, C.SNat{}, 1n) == Some{C.Err{1n}} : Bool}" }]);
});

test("right mutants pass, through a file import, a directory import and a premise", () => {
  const r = run("fixture_ok.ts");
  expect(r.out).toContain("PASS: all 5 mutants");
  expect(r.out).toContain("(counter not tied to the law)");
  // the row whose mutant relaxes the law's premise: check 1 is vacuous there,
  // and the line says so
  expect(r.out).toContain("(premise false on the core)");
  expect(r.code).toBe(0);
});

test("two sections under one header are refused by name and line", () => {
  expect(duplicateSections("# a\n# ---- x ----\nb\n# ---- y ----\nc\n# ---- x ----\n")).toEqual([
    { header: "# ---- x ----", lines: [2, 6] },
  ]);
  // a line with more between the dashes is a name like any other, and one
  // header alone is no duplicate
  expect(duplicateSections("# ---- tools: what first does ----\n\n# ---- a ----\n")).toEqual([]);
  expect(duplicateSections("def f() -> Nat:\n  0n\n")).toEqual([]);
});

for (const [i, says] of [
  [0, "false on the core itself"],
  [1, "still holds on the mutant"],
  [2, "not Laws.keep_same"],
  [3, 'no counterexample: give "at"'],
  [4, "occurs 2 times"],
  [5, 'at gives no value for the binder "n"'],
  [6, 'at names "m"'],
  [7, 'the law\'s premise "h" is false on the mutant'],
] as const) {
  test(`a wrong mutant is refused: ${says}`, () => {
    const r = run("fixture_bad.ts", String(i));
    expect(r.out).toContain(says);
    expect(r.code).toBe(1);
  });
}

test("an import that names nothing stops the run by name, before any check", () => {
  const tmp = mkdtempSync(join(tmpdir(), "falsify-gone-"));
  try {
    cpSync(`${import.meta.dir}/tree`, join(tmp, "tree"), { recursive: true });
    rmSync(join(tmp, "tree/group/shared.bend"));
    const r = run("../src/falsify.ts", "mutants", join(tmp, "tree/group/proj"));
    expect(r.out).toContain("core.bend: import ../shared.bend does not exist:");
    expect(r.out).not.toContain("counterexample");
    expect(r.code).toBe(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("two sections under one header stop the run, by name and line", () => {
  const tmp = mkdtempSync(join(tmpdir(), "falsify-dup-"));
  try {
    cpSync(`${import.meta.dir}/tree`, join(tmp, "tree"), { recursive: true });
    const proof = join(tmp, "tree/group/proj/PROOF.bend");
    writeFileSync(proof, readFileSync(proof, "utf8").replace("# ---- keep is the identity ----", "# ---- double adds ----"));
    const r = run("../src/falsify.ts", "mutants", join(tmp, "tree/group/proj"));
    expect(r.out).toContain('duplicate section header "# ---- double adds ----"');
    expect(r.out).not.toContain("PASS:");
    expect(r.code).toBe(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("falsify: a law that holds on every instance", () => {
  const r = run("../src/falsify.ts", `${import.meta.dir}/spec_ok.ts`);
  expect(r.out).toContain("holds on all 4 instances");
  expect(r.code).toBe(0);
});

test("falsify: a counterexample is named, alone and with --each", () => {
  const one = run("../src/falsify.ts", `${import.meta.dir}/spec_bad.ts`);
  expect(one.out).toContain("COUNTEREXAMPLE wrong");
  expect(one.code).toBe(1);
  const each = run("../src/falsify.ts", `${import.meta.dir}/spec_bad.ts`, "--each");
  expect(each.out).toContain("1 of 2 instances fail");
  expect(each.code).toBe(1);
});

test("cli: mutants [dir] runs <dir>/mutants.json", () => {
  const r = run("../src/falsify.ts", "mutants", `${import.meta.dir}/tree/group/proj`);
  expect(r.out).toContain("PASS: all 5 mutants");
  expect(r.code).toBe(0);
});

test("cli: a spec may be JSON", () => {
  const r = run("../src/falsify.ts", `${import.meta.dir}/spec_bad.json`);
  expect(r.out).toContain("COUNTEREXAMPLE wrong");
  expect(r.code).toBe(1);
});

test("falsify: a spec under a directory whose name is not plain, such as .worktrees/", () => {
  const root = mkdtempSync(join(tmpdir(), "bf-"));
  try {
    const at = join(root, ".worktrees", "branch");
    cpSync(join(import.meta.dir, "tree"), join(at, "tree"), { recursive: true });
    cpSync(join(import.meta.dir, "spec_ok.ts"), join(at, "spec_ok.ts"));
    const r = run("../src/falsify.ts", join(at, "spec_ok.ts"));
    expect(r.out).toContain("holds on all 4 instances");
    expect(r.code).toBe(0);
    // The scratch directory beside the spec is gone once the run ends.
    expect(readdirSync(at).filter((f) => f.startsWith("falsify-"))).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
