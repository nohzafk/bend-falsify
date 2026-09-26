import { expect, test } from "bun:test";
import { mutate, placeProject, relativeImports } from "../src/mutants.ts";

const run = (file: string, ...args: string[]) => {
  const r = Bun.spawnSync(["bun", `${import.meta.dir}/${file}`, ...args]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

test("relative imports of any depth, and how far the deepest climbs", () => {
  const r = relativeImports(["import Base\nimport ./core.bend as C\nimport ../base-facts/a.bend as A\n", "import ../../bend-schema/core/core.bend as S\n"]);
  expect(r.dirs.sort()).toEqual(["../../bend-schema", "../base-facts"]);
  expect(r.depth).toBe(2);
  expect(relativeImports(["import ./core.bend as C\n"]).depth).toBe(1);
});

test("the project sits under its real ancestors, deep enough for every import", () => {
  expect(placeProject("/tmp/r", "/home/u/projects/app/lib", 2)).toBe("/tmp/r/projects/app/lib");
  expect(placeProject("/tmp/r", "/home/u/projects/app/lib", 1)).toBe("/tmp/r/app/lib");
  expect(() => placeProject("/tmp/r", "/a", 3)).toThrow("past the filesystem root");
});

test("a mutation replaces exactly one whole line, or refuses", () => {
  expect(mutate("a\nb\nc", "b", "x", "L")).toBe("a\nx\nc");
  expect(() => mutate("a\nb", "z", "x", "L")).toThrow("not in core.bend");
  expect(() => mutate("b\nb", "b", "x", "L")).toThrow("occurs 2 times");
  expect(mutate("b\nb", "b", "x", "L", 2)).toBe("b\nx");
  expect(() => mutate("b\nb", "b", "x", "L", 3)).toThrow("nth 3");
});

test("right mutants pass, through an import two levels up and one in a subdirectory", () => {
  const r = run("fixture_ok.ts");
  expect(r.out).toContain("PASS: all 2 mutants");
  expect(r.code).toBe(0);
});

for (const [i, says] of [
  [0, "false on the core itself"],
  [1, "still holds on the mutant"],
  [2, "not LAWS.keep_same"],
  [3, "no counterexample"],
  [4, "occurs 2 times"],
] as const) {
  test(`a wrong mutant is refused: ${says}`, () => {
    const r = run("fixture_bad.ts", String(i));
    expect(r.out).toContain(says);
    expect(r.code).toBe(1);
  });
}

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
