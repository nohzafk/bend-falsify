// One wrong mutant per way a mutant can be wrong; run with the case's index.
import { type Mutant, runMutants } from "../src/mutants.ts";

const base = { law: "double_adds", section: "double adds", from: "  Nat.mul(n, K.two())", to: "  Nat.mul(n, 3n)", why: "double triples", failsIn: "LAWS.double_adds" };
const CASES: Mutant[] = [
  // the counterexample is false on the core itself
  { ...base, counter: "{C.double(1n) == 3n : Nat}" },
  // the counterexample still holds on the mutant: the law is not shown false
  { ...base, counter: "{C.double(0n) == 0n : Nat}" },
  // the proof fails, but not in the named def
  { ...base, counter: "{C.double(1n) == 2n : Nat}", failsIn: "LAWS.keep_same" },
  // no counterexample at all
  { ...base, counter: "" },
  // a repeated line without nth is ambiguous
  { law: "keep_same", section: "keep is the identity", from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)",
    why: "keep adds one", counter: "{C.keep(0n) == 0n : Nat}", failsIn: "LAWS.keep_same" },
];
runMutants(import.meta.dir + "/tree/group/proj", [CASES[Number(process.argv[2])]]);
