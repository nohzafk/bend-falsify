import { expect, test } from "bun:test";
import { sectionOf, failsInShared } from "../src/mutants.ts";
const P = "import Base\ndef h0(): Nat\n  0n\n# ---- tools: x ----\ndef lem(a: Nat) -> Nat:\n  a\n# ---- my law ----\ndef own(a):\n  a\ndef Laws.x(a):\n  own(a)\n";
test("sectionOf finds the section that declares a def; failsInShared flags the head and tools sections", () => {
  expect(sectionOf(P, "lem")).toBe("# ---- tools: x ----");
  expect(sectionOf(P, "own")).toBe("# ---- my law ----");
  expect(sectionOf(P, "h0")).toBe("");
  expect(sectionOf(P, "LAWS.x")).toBe(undefined);
  expect(sectionOf(P, "le")).toBe(undefined);
  expect(failsInShared(P, "lem")).toBe(true);
  expect(failsInShared(P, "h0")).toBe(true);
  expect(failsInShared(P, "own")).toBe(false);
  expect(failsInShared(P, "LAWS.x")).toBe(false);
});
