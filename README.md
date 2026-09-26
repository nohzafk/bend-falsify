# bend-falsify

Two checks for a Bend 2 project's laws. In both, you write the instances and the Bend checker decides.

- **`bend-falsify <spec.ts> [--each]`** runs candidate laws on literal instances before you prove them. Each instance becomes `def x() -> <claim>: {==}`. The checker runs the code on the literals, so an instance closes exactly when the law holds there.
- **`runMutants(projectDir, MUTANTS)`** checks that each law's proof depends on the code. Each mutant replaces one line of `core.bend` and names a counterexample. It passes only when all four of these hold:
  1. the counterexample holds on the core;
  2. it fails on the mutated core, so the law really is false there;
  3. the law's proof checks on the core;
  4. the proof fails on the mutant, in the def the mutant names.

These tools complement [lawcheck](https://github.com/bendlib/bendlib/tree/main/tools/lawcheck), which generates instances and mutants itself. Reach for this package when lawcheck skips a law: a law with a function-typed binder (`~rule: Nat -> Raw -> Maybe<Err>`), a law whose claim uses a premise's proof, or a counterexample that only exists above lawcheck's small scope.

Every checker run is limited to 5 s. A check that runs longer is a problem to fix, not a limit to raise.

## Install

```jsonc
// package.json
"devDependencies": { "bend-falsify": "github:nohzafk/bend-falsify" }
```

`bend` must be on `PATH`.

## Falsifying a law

A spec default-exports `{ imports, instances }`. Imports are relative to the spec file:

```ts
export default {
  imports: ["../core.bend as C"],
  instances: [
    { name: "d2", claim: "{C.double(2n) == 4n : Nat}" },
  ],
};
```

`bunx bend-falsify spec.ts` checks all instances in one run and reports the first counterexample. `--each` checks every instance alone, in parallel, and lists every counterexample.

## Mutants

The project needs `core.bend`, `LAWS.bend` and `PROOF.bend` in one directory. `PROOF.bend` is split into sections by `# ---- <name> ----` headers, and a section whose header contains `tools` holds the shared lemmas. One run keeps only the tools and the law's own section. This matters because the checker stops at the first failing def.

```ts
import { type Mutant, runMutants } from "bend-falsify";

const MUTANTS: Mutant[] = [
  { law: "keep_same", section: "keep is the identity",
    from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)",   // one whole line of core.bend
    why: "keep adds one",
    counter: "{C.keep(0n) == 0n : Nat}",              // over the core `as C`; holds, then fails
    failsIn: "LAWS.keep_same" },                      // the def the checker must name
];
runMutants(import.meta.dir, MUTANTS);
```

- A law proved from other laws names their sections in `with`.
- When the `from` line occurs more than once in `core.bend`, `nth` says which occurrence (1 is the first). Without it, a repeated line is refused as ambiguous.
- The scratch tree mirrors the project's place in the filesystem as far as its relative imports climb (`../x`, `../../x`, …). It copies the project directory whole, with its subdirectories, plus the directories it imports, and it never writes outside its own temp root.

## Gate

`sh test.sh` runs a fixture project that imports two levels up, with right mutants, each way a mutant can be wrong, and the falsifier's pass and fail.
