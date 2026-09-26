// Mutants that are right: each law false at the counterexample, each proof broken.
import { runMutants } from "../src/mutants.ts";

runMutants(import.meta.dir + "/tree/group/proj", [
  { law: "double_adds", section: "double adds", from: "  Nat.mul(n, K.two())", to: "  Nat.mul(n, 3n)",
    why: "double triples", counter: "{C.double(1n) == 2n : Nat}", failsIn: "LAWS.double_adds" },
  { law: "keep_same", section: "keep is the identity", from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)", nth: 1,
    why: "keep adds one", counter: "{C.keep(0n) == 0n : Nat}", failsIn: "LAWS.keep_same" },
]);
