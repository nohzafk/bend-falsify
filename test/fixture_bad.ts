// One wrong mutant per way a mutant can be wrong; run with the case's index.
import { type Mutant, runMutants } from "../src/mutants.ts";

const DOUBLE = { law: "double_adds", section: "double adds", from: "  Nat.mul(n, K.two())", to: "  Nat.mul(n, 3n)", why: "double triples", failsIn: "LAWS.double_adds" };
const KEEP2 = { law: "keep2_when_keep", section: "keep2 is the identity while keep is", from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)", why: "keep2 adds one", failsIn: "LAWS.keep2_when_keep" };
const CASES: Mutant[] = [
  // a claim written by hand that is false on the core itself
  { ...DOUBLE, counter: "{C.double(1n) == 3n : Nat}" },
  // the instance holds on the mutant too: the law is not shown false
  { ...DOUBLE, at: { n: "0n" } },
  // the proof fails, but not in the named def
  { ...DOUBLE, at: { n: "1n" }, failsIn: "LAWS.keep_same" },
  // no counterexample at all
  { ...DOUBLE },
  // a repeated line without nth is ambiguous
  { law: "keep_same", section: "keep is the identity", from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)",
    why: "keep adds one", at: { n: "0n" }, failsIn: "LAWS.keep_same" },
  // at leaves a binder without a value
  { ...DOUBLE, at: {} },
  // at names something the law does not bind
  { ...DOUBLE, at: { n: "1n", m: "0n" } },
  // the instance does not satisfy the law's premise: mutating keep falsifies
  // the premise that keep is the identity
  { ...KEEP2, nth: 1, at: { n: "0n" } },
];
runMutants(import.meta.dir + "/tree/group/proj", [CASES[Number(process.argv[2])]]);
