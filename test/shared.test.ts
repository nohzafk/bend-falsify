import { expect, test } from "bun:test";
import { sectionOf, failsInShared, onlyLaws } from "../src/mutants.ts";
const P = "import Base\ndef h0(): Nat\n  0n\n# ---- tools: x ----\ndef lem(a: Nat) -> Nat:\n  a\n# ---- my law ----\ndef own(a):\n  a\ndef Other.x(a):\n  own(a)\n";
test("sectionOf finds the section that declares a def; failsInShared flags the head and tools sections", () => {
  expect(sectionOf(P, "lem")).toBe("# ---- tools: x ----");
  expect(sectionOf(P, "own")).toBe("# ---- my law ----");
  expect(sectionOf(P, "h0")).toBe("");
  expect(sectionOf(P, "Laws.x")).toBe(undefined);
  expect(sectionOf(P, "le")).toBe(undefined);
  expect(failsInShared(P, "lem")).toBe(true);
  expect(failsInShared(P, "h0")).toBe(true);
  expect(failsInShared(P, "own")).toBe(false);
  expect(failsInShared(P, "Laws.x")).toBe(false);
});

const L = "import Base\nlaw a:\n  for x: Nat\n  {x == x : Nat}\n\n# helpers the next law needs\ntype Act is Data:\n  case @Go:\n\ndef run(a: Act) -> Nat:\n  0n\n\nlaw b:\n  for a: Act\n  {run(a) == 0n : Nat}\n";
test("onlyLaws drops a removed law but keeps every type and def after it", () => {
  const kept = onlyLaws(L, ["b"]);
  expect(kept).not.toContain("law a:");
  expect(kept).toContain("type Act is Data:");
  expect(kept).toContain("def run(a: Act)");
  expect(kept).toContain("law b:");
  expect(onlyLaws(L, [])).toContain("type Act is Data:");
});
