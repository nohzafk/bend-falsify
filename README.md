# bend-falsify

Two checks for a Bend 2 project's laws. In both you write the instances and
the mutants, and the Bend checker decides.

- **`bend-falsify <spec.ts|spec.json> [--each]`** runs candidate laws on
  literal instances before you prove them. Each instance becomes
  `def <name>() -> <claim>: {==}`, so it closes exactly when the law holds at
  those literals.
- **`runMutants(projectDir, TABLE)`**, or `bend-falsify mutants [dir]` for the
  table as JSON, checks that each law's proof depends on `core.bend`. Each
  mutant replaces one line of `core.bend` and names a counterexample at
  literals.

`examples/plus0/` is a whole project that uses both. Every snippet below is an
excerpt of it, and `sh test.sh` runs its spec, its table, and a broken copy of
each, so nothing here can drift from the code.

## Contents

1. [Install and run](#1-install-and-run)
2. [The project layout](#2-the-project-layout)
3. [PROOF.bend](#3-proofbend)
4. [LAWS.bend](#4-lawsbend)
5. [The mutant table](#5-the-mutant-table)
6. [Writing a counter](#6-writing-a-counter)
7. [mutants.json or a TS table](#7-mutantsjson-or-a-ts-table)
8. [Falsify specs](#8-falsify-specs)
9. [Troubleshooting](#9-troubleshooting)
10. [Where this fits](#10-where-this-fits)

---

## 1. Install and run

Both ways need `bun` and `bend` on `PATH`. `bend` is the compiler the tool
shells out to; it runs `bend <file> --check-only` from the project directory.
Without it every check fails with
`error: Executable not found in $PATH: "bend"`.

**A pure Bend project** needs no `package.json`. Keep the mutant table and the
specs as JSON and run the package straight from GitHub. Pin a commit:

```sh
bunx github:nohzafk/bend-falsify#<sha> mutants .                 # reads ./mutants.json
bunx github:nohzafk/bend-falsify#<sha> spec.json [--each]
```

**A TypeScript project** adds it as a dev dependency. It can then write the
table in TS, call `runMutants` itself, and write specs that compute their
instances:

```jsonc
// package.json
"devDependencies": { "bend-falsify": "github:nohzafk/bend-falsify" }
```

Exit codes, both commands:

| code | meaning |
| --- | --- |
| 0 | every check passed |
| 1 | a counterexample, a wrong mutant, a timeout, or any thrown error |
| 2 | the command line was wrong: no spec, or a `mutants.json` that is not an array |

A check that runs longer than 5 s is stopped. The limit is not configurable.
The tool reports it as `TIMEOUT: the checker ran past 5 s: a problem to fix,
not a limit to raise` (the spec path) or `<file>: the checker ran past 5 s: a
problem to fix, not a limit to raise` (the mutant path). A slow check is a
problem in the Bend, not in this tool.

---

## 2. The project layout

`runMutants` reads three files from one directory, under exactly these names:

```
my-project/
  core.bend      the code the laws are about
  LAWS.bend      the laws
  PROOF.bend     the proofs, split into sections
  mutants.json   the table, if you run it as data
  spec.json      a falsify spec, if you run it as data
```

- **The names are exact and case-sensitive.** `Core.bend` or `laws.bend` is a
  missing file: the run stops with
  `ENOENT: no such file or directory, open '<dir>/core.bend'`.
- **All three sit in one directory** — the `projectDir` you pass, or the `dir`
  you give `bend-falsify mutants`.
- `bend-falsify mutants [dir]` reads `<dir>/mutants.json` and uses `<dir>` as
  the project directory. With no argument it uses `.`. A missing table reads
  as `error: Cannot find module '<dir>/mutants.json'`.

### Imports

`core.bend`, `LAWS.bend` and `PROOF.bend` may import each other and any other
file, at any depth. The tool copies the project, and everything it imports
that lives outside the project, into a scratch tree, then checks there. The
temporary tree is removed whatever happens.

The scratch tree keeps the project under **its real ancestors' names**, deep
enough for the deepest import to resolve:

- `depth` is the largest number of `..` in any one outward import of the three
  files, and at least 1; `../lib/facts.bend` is depth 1, `../../bend-schema/x`
  is depth 2.
- the project is placed `depth` directories below the scratch root. A project
  at `/home/u/app/lib` with depth 2 is placed at `<root>/app/lib`, so
  `../../bend-schema` resolves to `<root>/bend-schema`, which is where the
  copy of it went.
- if the project path has `depth` parts or fewer, the run stops:
  `<abs>: imports climb <depth> levels, past the filesystem root`.

Rules that follow, and the ones that surprise people:

- **Only the directory in an outward import is copied.** The tool looks for
  `^import ((?:\.\.\/)+)([^/\s]+)\/` — `../<dir>/…`. An import that climbs out
  to a bare file, `import ../shared.bend as S`, matches nothing, so that file
  is not copied and the check fails with `no such file` inside the scratch
  tree. The failure surfaces as `the counterexample is false on the core
  itself`, which is not what happened. Keep shared code in a directory, or
  keep it inside the project.
- **An import that resolves outside the scratch root is refused**, with
  `import <rel>: would land outside the scratch tree`. An import that names a
  directory that does not exist is refused with
  `import <rel>: <abs> does not exist`.
- `node_modules` and `.git` are never copied.

An import inside the project (`./core.bend`, `./sub/k.bend`) needs nothing
extra: the project directory is copied whole, with its subdirectories.

---

## 3. PROOF.bend

`PROOF.bend` is one file holding every law's proof. The mutant run cuts it
apart, so its shape is part of the contract.

```bend
import Base
import ./LAWS.bend as Laws
import ./core.bend as C

# The head of this file -- the imports above, and any def above the first
# "# ---- ... ----" header -- is kept in every mutant run.

# ---- tools: the one fact about Nat.add the proofs here rewrite with ----
#
# Base states no fact about Nat.add, so it is proved here, by induction on
# the first argument. A header whose name contains "tools" is kept in every
# mutant run, whatever law is being checked.

def add_zero(a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}
```

### The header

A section header is a line that matches `^# ---- .* ----$`: `# ---- `, a name,
` ----`, and nothing else on the line.

```bend
# ---- plus0 adds nothing ----
```

- The name between the dashes is what a mutant's `section` field names.
- **A header that does not match starts no section.** The text after it joins
  the section before it. There is no error for this; you get either
  `<law>: no section "<section>" in PROOF.bend` or a proof that suddenly
  depends on text from elsewhere in the file.
- A header whose whole line contains **`tools`** marks shared lemmas. Keep
  those sections in every run — the run keeps a tools section whether or not a
  mutant names it.
- The **head** of the file — the imports, and any def above the first header —
  is kept in every run too. A def used by every proof can go there.
- **Two headers with the same name are not refused.** Both sections are kept
  and their text is concatenated, so the proof usually breaks in a way that
  names neither. Give each section its own name.

### One law per section

Each law's proof sits under its own header, and the law's name is in the
section's name only by convention — the link is the mutant's `section` field:

```bend
# ---- plus0 adds nothing ----

def Laws.plus0_same(n):
  %add_zero(n) : {Nat.add(n, 0n) == _ : Nat}
  {==}
```

- The proof def is `def Laws.<law>`, using the alias `LAWS.bend` is imported
  as.
- **A run keeps only the tools sections and the section the mutant names**,
  and it rewrites `LAWS.bend` so that only the named laws' `law` blocks
  survive.
- That isolation is the point. The checker stops at the first failing def, and
  two proofs over the same definitions break together. Checked against the
  whole file, a mutant would be blamed on whichever proof happens to come
  first.
- **A law whose proof uses another law's proof must say so**, with the
  `with` field. Otherwise its section is dropped and the run fails its own
  control: `the proof does not check even unmutated (<location>)`.

```bend
# ---- twice is the same ----

def Laws.plus0_twice_same(n):
  %Equal.sym(Nat, Nat.add(n, 0n), n, Laws.plus0_same(n)) : {Nat.add(_, 0n) == n : Nat}
  %Equal.sym(Nat, Nat.add(n, 0n), n, Laws.plus0_same(n)) : {_ == n : Nat}
  {==}
```

`Laws.plus0_same` lives in the section `plus0 adds nothing`, so this mutant
carries `"with": ["plus0 adds nothing"]`.

### `failsIn`

The checker prints a failing def as

```
Location: LAWS.plus0_twice_same
```

`failsIn` is that string, exactly. The checker names a def after the file that
declares it, so:

- a law `plus0_twice_same` in `LAWS.bend` is `LAWS.plus0_twice_same` — the
  usual case, because every law's proof def is `def Laws.<law>`;
- a helper def declared at the top level of `PROOF.bend` and called `plain_def`
  is `plain_def`.

You do not have to guess it. Put a wrong `failsIn` in and read the message:
`failed in LAWS.plus0_same, not LAWS.plus0_slow_same, when plus0 adds one` —
the first name is the truth.

---

## 4. LAWS.bend

`LAWS.bend` holds the laws, and may hold anything else your proofs read.

```bend
import Base
import ./core.bend as C

# Adding nothing is the identity, for every n.
law plus0_same:
  for n: Nat
  {C.plus0(n) == n : Nat}
```

The run rewrites this file before checking. It splits it at the start of every
line that begins with `law `, `def ` or `# ---- `, and keeps:

- every block that does not begin with `law ` — so imports, `def`s, comments
  and types all survive;
- a block that begins with `law ` only when it begins with `law <name>:` for a
  name the run is keeping.

Rules:

- **A law starts with `law <name>:` at the beginning of a line.** An indented
  `law`, or `law<name>`, is not a block boundary and is not filtered.
- **The name must match the mutant's `law` field exactly.** The match is
  `law <name>:` including the colon; `plus0_same` does not match
  `plus0_same_2`.
- Put the executable definitions in `core.bend`. A `def` in `LAWS.bend`
  survives every run — the split keeps every block that does not begin with
  `law ` — so a helper there is always in scope. A *section* of `PROOF.bend` is
  not: only the tools sections and the sections a mutant names are kept.
- A `with` name is a **section** name, not a law name, and some mutant in the
  same table must have that section. Otherwise the run stops with
  `no mutant has the section "<section>", so its law is unknown`.

---

## 5. The mutant table

One row per law. All fields, and what each one has to be:

| field | type | meaning |
| --- | --- | --- |
| `law` | string | the law to check, exactly as `law <name>:` names it in `LAWS.bend` |
| `section` | string | the text between the dashes of its `# ---- <name> ----` header |
| `from` | string | one whole line of `core.bend`, replaced |
| `to` | string | the line put in its place |
| `why` | string | why the law is false after the change, in words |
| `counter` | string | a claim at literals that holds on the core and fails on the mutant |
| `failsIn` | string | the def the checker must name when the mutant breaks the proof |
| `nth` | number, optional | which occurrence of `from` (1 = first), when it occurs more than once |
| `with` | string[], optional | other laws' sections this proof builds on |

```jsonc
// examples/plus0/mutants.json
[
  {
    "law": "plus0_same",
    "section": "plus0 adds nothing",
    "from": "  Nat.add(n, 0n)",
    "to": "  Nat.add(n, 1n)",
    "nth": 1,
    "why": "plus0 adds one",
    "counter": "{C.plus0(0n) == 0n : Nat}",
    "failsIn": "LAWS.plus0_same"
  }
]
```

### `from` and `to`

- **`from` matches one whole line, exactly** — the full text between two
  newlines, **leading indentation included**. A line reading
  `  Nat.add(n, 0n)` (two spaces) does not match `Nat.add(n, 0n)`, and does not
  match the `  Nat.add(n, 0n)` inside `  plus0(Nat.add(n, 0n))`.
- A line that is not in `core.bend` is refused:
  `the line to mutate is not in core.bend: "  Nat.add(n, 9n)"`.
- `to` replaces that whole line, as-is. It may be shorter or longer than the
  line it replaces. It must still be valid Bend: a `to` the checker cannot
  parse fails the run with `failed in ?, not <failsIn>` or with
  `the counterexample is false on the core itself` — the `?` is the checker
  having no location to name.
- **A line that occurs more than once needs `nth`.** Without it the mutant is
  ambiguous, and the run refuses it:
  `the line to mutate occurs 2 times in core.bend (lines 6, 9); say which with
  nth: "  Nat.add(n, 0n)"`. The numbers are 1-based, in file order.
- An `nth` past the last occurrence is refused:
  `nth 5, but the line occurs 2 times in core.bend: "  Nat.add(n, 0n)"`.

### The four checks

Each mutant runs four checks, in this order, and stops at the first that
fails. Only the first is a formality; the rest are the point.

| # | check | it fails with |
| --- | --- | --- |
| 1 | the counterexample holds on the core as it is | `the counterexample is false on the core itself: <counter>` |
| 2 | the counterexample fails on the mutated core | `the counterexample still holds on the mutant, so the law is not shown false: <counter>` |
| 3 | the law's proof checks on the core as it is | `the proof does not check even unmutated (<location>)` |
| 4 | the proof fails on the mutated core, in `failsIn` | `still checks when <why>`, or `failed in <loc>, not <failsIn>, when <why>` |

Checks 1 and 2 are what make `why` a checked claim. A proof that fails on a
mutant where the law still holds would otherwise count as a kill (check 2), and
a proof that still checks against a false law would be saying nothing about the
core (check 4).

A missing `counter` is refused before any check runs:
`no counterexample: say at which literals the law is false after the mutation`.

Checks 1 to 4 print one line per law as they run:

```
  plus0_same                 PASS  false when plus0 adds one; fails in LAWS.plus0_same
```

and the run ends with

```
PASS: all 3 mutants are false laws, and break the proof they target
```

or, with a non-zero exit,

```
FAIL: 1 of 3 mutants did not break the proof they target
```

Read the count as "1 of the 3 mutants failed".

---

## 6. Writing a counter

A counter is a **concrete instance of the law, closed over literals**, stated
as a Bend claim:

```
{lhs == rhs : T}
```

The tool writes it into a file of its own as

```bend
def counter() -> {lhs == rhs : T}:
  {==}
```

so both sides must reduce to the same term on the core, and must not on the
mutant. There is no hypothesis, no variable, and no proof: `{==}` closes it or
it does not.

Derive it from the law. The law says

```bend
law plus0_same:
  for n: Nat
  {C.plus0(n) == n : Nat}
```

Pick the smallest `n` where the mutant breaks it. If the mutant turns `plus0`
into `Nat.add(n, 1n)`, then `n = 0`:

```jsonc
"counter": "{C.plus0(0n) == 0n : Nat}"
```

On the core `C.plus0(0n)` is `0n`, so the claim holds. On the mutant it is
`1n`, so it does not. One literal is usually enough — pick the smallest that
separates the two.

Rules:

- **`C` is `core.bend`.** The counter file starts with `import Base` and
  `import ./core.bend as C`, then **every other import `LAWS.bend` has**,
  verbatim. So a claim may name `C`, and may name anything else the laws
  import by its alias. `LAWS.bend`'s own import of the core is left out: one
  file under two names is a checker error.
- **A claim may not call a law or a proof def.** Only the core and the other
  imports are in scope, and the body is `{==}` — there is no proof to write.
- **Keep the literals small.** The checker walks numerals down, and a big one
  is slow, and may overrun the 5 s limit.
- A counter that holds on the mutant is rejected, however true it is on the
  core: the law must be shown false, not merely unproved.

---

## 7. mutants.json or a TS table

The same table, two ways to write it.

**`mutants.json`** — an array of the objects in §5, beside `core.bend`:

```sh
bunx bend-falsify mutants .          # or: bunx bend-falsify mutants path/to/project
```

The tool imports `<dir>/mutants.json` and passes its array to `runMutants`. A
file that is not an array is refused before anything runs:
`<dir>/mutants.json: expected an array of mutants`, exit 2.

**A TypeScript table** — same array, typed, calling the function:

```ts
import { type Mutant, runMutants } from "bend-falsify";

const MUTANTS: Mutant[] = [
  { law: "plus0_same", section: "plus0 adds nothing",
    from: "  Nat.add(n, 0n)", to: "  Nat.add(n, 1n)", nth: 1,
    why: "plus0 adds one",
    counter: "{C.plus0(0n) == 0n : Nat}",
    failsIn: "LAWS.plus0_same" },
];
runMutants(import.meta.dir, MUTANTS);
```

`runMutants` is what both forms run; the JSON form is a thin reader over it.
Take the JSON form when the project has no TypeScript of its own. Take the TS
form when the table should be typed, generated, or share constants with the
rest of the project — and when the project is already a TS project, so the
call can sit in its own test script.

`projectDir` is the directory holding the three Bend files. `import.meta.dir`
is the directory of the table file, which is right when the table sits beside
them.

---

## 8. Falsify specs

A spec runs candidate laws at literals before anyone writes a proof. It is the
same idea as a counter, many at once, and it does not need `PROOF.bend` or
`LAWS.bend`.

### spec.json

```json
{
  "imports": ["./core.bend as C"],
  "instances": [
    { "name": "plus0_three", "claim": "{C.plus0(3n) == 3n : Nat}" },
    { "name": "plus0_slow_three", "claim": "{C.plus0_slow(3n) == 3n : Nat}" },
    { "name": "twice_seven", "claim": "{C.plus0_twice(7n) == 7n : Nat}" }
  ]
}
```

### spec.ts

```ts
export default {
  imports: ["./core.bend as C"],
  instances: [0, 1, 2, 3, 7].map((n) => ({ name: `p${n}`, claim: `{C.plus0(${n}n) == ${n}n : Nat}` })),
};
```

- A `.ts` spec is **run** — it may compute its instances, read the
  environment, or build names. A `.json` spec is read.
- `imports` are Bend import lines. One that **starts with `.` is resolved
  against the spec file's directory**, so `"./core.bend as C"` means the
  `core.bend` beside the spec. Anything else is passed through — `import Base`
  is added for you, so do not list it.
- **Every directory in the resolved path must be plain names** — letters,
  digits, `_` and `-`. The tool hands `bend` an absolute path, and `bend`
  refuses one whose directories hold anything else. A spec under
  `/tmp/tmp.AsC1lygCQ8/proj/` fails to compile with
  `an import path of plain names (letters, digits, _ and -; the hub's files
  import the hub's)`, whatever the spec says. `mktemp -d` on macOS produces
  exactly such a name; give the directory one yourself. The mutant path is not
  affected — its scratch tree is `bend-mutant-XXXXXX`.
- Each instance becomes `def <name>() -> <claim>: {==}` in one scratch file.
  The checker runs the code, so an instance closes exactly when the law holds
  at those literals.
- `name` is what the report calls the instance. Make it say what the literals
  are, and make it unique — the single-run report matches the checker's
  `Location:` against it.

### Running it

```sh
bend-falsify spec.ts            # one run, all instances; reports the first counterexample
bend-falsify spec.ts --each     # one run per instance, in parallel; reports every counterexample
```

Without `--each` there is one checker run, and the checker stops at the first
failing def, so you get one counterexample:

```
COUNTEREXAMPLE bad: expected 3n / observed 4n
  claim: {C.plus0(3n) == 4n : Nat}
```

With `--each` every instance is checked alone, so every failure is listed, and
the progress lines go to stderr:

```
1 of 4 instances fail:
bad: expected 3n / observed 4n
  claim: {C.plus0(3n) == 4n : Nat}
```

A pass reads `holds on all 3 instances (55 ms)`, or
`holds on all 3 instances, each alone (120 ms)` with `--each`. Either way the
exit code is 0, and 1 when something failed.

`--each` costs one checker run per instance, about 0.15 s each, so it is for
hundreds of instances, not thousands.

### Showing the falsifier can fail

A falsifier that has never failed proves nothing. Point the spec at a **copy of
the core with a bug planted in it**, and require a counterexample. An
environment variable keeps the two cores in one spec:

```ts
export default {
  imports: [process.env.CORE ?? "./core.bend as C"],
  instances: [0, 1, 2, 3].map((n) => ({ name: `p${n}`, claim: `{C.plus0(${n}n) == ${n}n : Nat}` })),
};
```

```sh
bunx bend-falsify spec.ts                  # holds
CORE=./core.buggy.bend bunx bend-falsify spec.ts   # must be refused
```

`examples/plus0/spec.json` does the same thing without an environment
variable: `test.sh` copies the project, edits one claim, and requires the run
to fail. A second spec, or a second import, is enough — the CLI has no
"expected to fail" flag.

---

## 9. Troubleshooting

Every message the tool can print, and what it means.

**The command line**

| message | cause |
| --- | --- |
| `usage: bend-falsify <spec.ts\|spec.json> [--each]` and `bend-falsify mutants [dir]   (reads <dir>/mutants.json)` | no argument, exit 2 |
| `<dir>/mutants.json: expected an array of mutants` | the JSON is not an array, exit 2 |
| `error: Cannot find module '<dir>/mutants.json'` | no table at that path |
| `error: Executable not found in $PATH: "bend"` | `bend` is not on `PATH` |
| `ENOENT: no such file or directory, open '<dir>/core.bend'` | `core.bend`, `LAWS.bend` or `PROOF.bend` is missing, or the name is not exact |

**A spec run**

| message | cause |
| --- | --- |
| `COUNTEREXAMPLE <name>: expected <E> / observed <O>` | the instance `<name>` is false; `<E>` is the left side, `<O>` the right |
| `<n> of <N> instances fail:` | `--each` found `<n>` failures, each printed with its claim |
| `TIMEOUT: the checker ran past 5 s: a problem to fix, not a limit to raise` | an instance does not check in 5 s — a large constant, a loop unfolded into a goal |
| the checker's own output, with no `Location:` | the spec did not compile: a bad import path, or claim syntax the checker rejects. The imports are resolved against the **spec file's directory** |
| `an import path of plain names (letters, digits, _ and -; the hub's files import the hub's)` | a directory in the spec's resolved path holds a dot, or another character outside that set. Give the project a plain-name path |

**The mutant table**

Messages in this group are prefixed with the law's name, and the run carries on
to the next mutant.

| message | cause |
| --- | --- |
| `the line to mutate is not in core.bend: "<from>"` | `from` is not a whole line of `core.bend`. Check the leading spaces |
| `the line to mutate occurs <n> times in core.bend (lines <a>, <b>); say which with nth: "<from>"` | a repeated line without `nth` |
| `nth <k>, but the line occurs <m> times in core.bend: "<from>"` | `nth` past the last occurrence |
| `no counterexample: say at which literals the law is false after the mutation` | `counter` is missing or empty |
| `the counterexample is false on the core itself: <counter>` | the claim does not hold before the mutation — state an instance of the law, not of the mutant. Also what a missing import in the scratch tree looks like |
| `the counterexample still holds on the mutant, so the law is not shown false: <counter>` | the mutation does not change that instance; pick literal values the mutation moves |
| `the proof does not check even unmutated (<location>)` | the proof needs a section the run dropped — name it in `with` — or it was already broken |
| `still checks when <why>` | the proof passes against the mutated core, so it does not depend on that line. Usual causes: the counter names a different def from the law's, or the proof is not connected to the core |
| `failed in <loc>, not <failsIn>, when <why>` | the proof broke, but in another def. `<loc>` is the truth; put it in `failsIn`. `<loc>` is `?` when the checker has no location: the mutated core does not compile, so `to` is not valid Bend |

**Errors that stop the run at once** (no per-mutant line, and the summary line
is not printed)

| message | cause |
| --- | --- |
| `<law>: no section "<section>" in PROOF.bend` | no `# ---- <section> ----` header with that exact text. Usually a header that does not match the format, or a `section` copied from another law |
| `no mutant has the section "<sec>", so its law is unknown` | a `with` entry that names a section no mutant in the table has. Every name in `with` must be some row's `section` |
| `import <rel>: <abs> does not exist` | an import that leaves the project names a directory that is not there |
| `import <rel>: would land outside the scratch tree` | an import whose `..` climbs past the scratch root |
| `<abs>: imports climb <depth> levels, past the filesystem root` | the project is too close to the filesystem root for its imports |
| `<file>: the checker ran past 5 s: a problem to fix, not a limit to raise` | a check that does not finish in 5 s |

---

## 10. Where this fits

This tool takes **hand-written instances and hand-written mutants**. The
mutant check asks one question a test suite does not: does this law's proof
still check once the line it is about changes? A proof that survives the change
was not about that line.

[lawcheck](https://github.com/bendlib/bendlib/tree/main/tools/lawcheck) does
the same two jobs by generation: it reads the laws and builds instances and
mutants itself. Reach for this package when lawcheck skips a law — a law with
a function-typed binder (`~rule: Nat -> Raw -> Maybe<Err>`), a law whose claim
uses a premise's proof, or a counterexample that only exists above lawcheck's
small scope. Reach for this package when the counterexample has to be chosen
by hand to be small enough to check.

Larger worked examples: [`bend-schema`](https://github.com/nohzafk/bend-schema)
`core/check_mutants.ts` (a table of 14 mutants) and `core/falsify/spec.ts` (a
spec that generates its instances, and takes `CORE=` to point at a mutated
core).

The example beside this file: `examples/plus0/` — three laws, three mutants,
one of them proved `with` another, and a spec of three instances. `sh test.sh`
runs all of it.
