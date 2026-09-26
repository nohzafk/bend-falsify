// Mutants that are right: each law false at the instance the mutant names, each
// proof broken. The last row writes its counterexample by hand -- the fallback
// for a law shape `at` cannot state -- and its report line says so.
import { runMutants } from "../src/mutants.ts";

runMutants(import.meta.dir + "/tree/group/proj", [
  { law: "double_adds", section: "double adds", from: "  Nat.mul(n, K.two())", to: "  Nat.mul(n, 3n)",
    why: "double triples", at: { n: "1n" }, failsIn: "LAWS.double_adds" },
  { law: "keep_same", section: "keep is the identity", from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)", nth: 1,
    why: "keep adds one", at: { n: "0n" }, failsIn: "LAWS.keep_same" },
  { law: "keep2_when_keep", section: "keep2 is the identity while keep is", from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)", nth: 2,
    why: "keep2 adds one", at: { n: "0n" }, failsIn: "LAWS.keep2_when_keep" },
  { law: "shift_same", section: "the file import steps by one", from: "  S.bump(n)", to: "  Nat.add(n, 2n)",
    why: "the step adds two", counter: "{C.shift(1n) == Nat.add(1n, 1n) : Nat}", failsIn: "LAWS.shift_same" },
]);
