// One wrong mutant per way a mutant can be wrong; run with the case's index.
import { type Mutant, runMutants } from "../src/mutants.ts";

const base = { law: "double_adds", section: "double adds", from: "  Nat.mul(n, 2n)", to: "  Nat.mul(n, 3n)", why: "double triples", failsIn: "LAWS.double_adds" };
const CASES: Mutant[] = [
  // the counterexample is false on the core itself
  { ...base, counter: "{C.double(1n) == 3n : Nat}" },
  // the counterexample still holds on the mutant: the law is not shown false
  { ...base, counter: "{C.double(0n) == 0n : Nat}" },
  // the proof fails, but not in the named def
  { ...base, counter: "{C.double(1n) == 2n : Nat}", failsIn: "LAWS.keep_same" },
  // no counterexample at all
  { ...base, counter: "" },
];
runMutants(import.meta.dir + "/tree/group/proj", [CASES[Number(process.argv[2])]]);
