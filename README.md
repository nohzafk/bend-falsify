# bend-falsify

Two checks for a Bend 2 project's laws. In both you write the instances and
the mutants, and the Bend checker decides.

- **`bend-falsify <spec.ts|spec.json> [--each]`** runs candidate laws on
  literal instances before you prove them. Each instance becomes
  `def <name>() -> <claim>: {==}`, so it closes exactly when the law holds at
  those literals.
- **`runMutants(projectDir, TABLE)`**, or `bend-falsify mutants [dir]` for the
  table as JSON, checks that each law's proof depends on `core.bend`. Each
  mutant replaces one line of `core.bend`, and names the law's own binders at
  literals (`at`) or a counterexample of its own (`counter`).

`examples/plus0/` is a whole project that uses both. Every snippet below is an
excerpt of it, or of the test fixture `test/tree/group/proj` where the text says
so, and `sh test.sh` runs the spec, the table, and a broken copy of each, so
nothing here can drift from the code.

## Contents

1. [Install and run](#1-install-and-run)
2. [The project layout](#2-the-project-layout)
3. [PROOF.bend](#3-proofbend)
4. [LAWS.bend](#4-lawsbend)
5. [The mutant table](#5-the-mutant-table)
6. [The counterexample, `at` and `counter`](#6-the-counterexample-at-and-counter)
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

- **What is copied is what the import names — a file or a directory.** The tool
  looks for `^import ((?:\.\.\/)+)([^/\s]+)` — `../<name>`, at any depth:
  - `../<name>/…` copies that directory: `import ../lib/facts.bend as F` copies
    `../lib`, so the file's neighbours come with it;
  - `../<name>` with nothing after it copies that file:
    `import ../shared.bend as S` copies `../shared.bend` and nothing else.
- **An import that names nothing on disk stops the run before any check**, by
  name and with the file that makes it:
  `FAIL: LAWS.bend: import ../shared.bend does not exist: /lib/shared.bend`. It
  is not a counter failure, which is what it used to look like from the
  scratch tree: `the counterexample is false on the core itself`.
- **The three files' imports are what is mirrored, not their imports'
  imports.** A shared file that itself reads something beside it is mirrored
  whole when it is imported as a directory (`../lib/facts.bend`); imported as a
  file (`../shared.bend`), it arrives alone.
- **An import that resolves outside the scratch root is refused**, with
  `import <rel>: would land outside the scratch tree`.
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

# ---- tools: the facts about Nat.add and Nat.cmp the proofs here rewrite with ----
#
# Base states no fact about Nat.add, so it is proved here, by induction on
# the first argument; Base states none about Nat.cmp either, and a law whose
# claim is a Bool needs one. A header whose name contains "tools" is kept in
# every mutant run, whatever law is being checked.

def add_zero(a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def cmp_refl_r(a: Nat) -> {EQ{} == Nat.cmp(a, a) : Cmp}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %cmp_refl_r(p) : {EQ{} == _ : Cmp}
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
- **Two headers with the same name stop the run**, before any check, with the
  header and both line numbers:

  ```
  FAIL: PROOF.bend: duplicate section header "# ---- double adds ----" (lines 23, 28); give each section its own name
  ```

  Left alone, both sections are kept under one name and their text is
  concatenated, so the proof breaks in a way that names neither.

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

`failsIn` is that string, exactly. The checker names a def after the **file** it
declares it in, so the alias the proof is written with is not the name it
reports. Side by side, the same proof:

```bend
# PROOF.bend -- the def, written with the alias LAWS.bend is imported as
# ---- plus0 adds nothing ----

def Laws.plus0_same(n):
  %add_zero(n) : {Nat.add(n, 0n) == _ : Nat}
  {==}
```

```
# what the checker prints when that proof breaks
Location: LAWS.plus0_same
```

```jsonc
// the mutant's field: the file's stem, not the alias
"failsIn": "LAWS.plus0_same"
```

So:

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
| `at` | object | the law's binders, each at a literal — `{ "n": "0n" }`. The tool reads the law and builds the instance, so it cannot be a claim that is not the law |
| `counter` | string, optional | a claim of your own, for a law shape `at` cannot state. The report line then says it is not tied to the law |
| `failsIn` | string | the def the checker must name when the mutant breaks the proof |
| `nth` | number, optional | which occurrence of `from` (1 = first), when it occurs more than once |
| `with` | string[], optional | other laws' sections this proof builds on |

**One of `at` and `counter` is required**, and `at` is what you want: it is
read against the law, so it cannot drift from it. §6 has the substitution rule
and the fallback.

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
    "at": { "n": "0n" },
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

### The five checks

Each mutant runs five checks, in this order, and stops at the first that
fails. Only the first and last two are about the proof; the middle ones are
what make the counterexample an instance of the law.

| # | check | it fails with |
| --- | --- | --- |
| 1 | the counterexample holds on the core as it is — **where the law applies**: if every premise the instance carries holds on the core, the claim must hold too. A premise that is false on the core leaves nothing to check the claim against, and check 1 passes vacuously | `the counterexample is false on the core itself: <claim>` |
| 2 | each premise `at` instantiates holds on the mutant | `the law's premise "<binder>" is false on the mutant, so this instance is not a counterexample: <premise>` |
| 3 | the counterexample fails on the mutated core | `the counterexample still holds on the mutant, so the law is not shown false: <claim>` |
| 4 | the law's proof checks on the core as it is | `the proof does not check even unmutated (<location>)` |
| 5 | the proof fails on the mutated core, in `failsIn` | `still checks when <why>`, or `failed in <loc>, not <failsIn>, when <why>` |

Checks 1 to 3 are what make `why` a checked claim. A proof that fails on a
mutant where the law still holds would otherwise count as a kill (check 3), and
a proof that still checks against a false law would be saying nothing about the
core (check 5).

**Check 1 is conditional for an `at` instance, because a mutant can move a
law's premise instead of its claim.** A law is a statement about the values its
premises admit, so where a premise is false the law says nothing, and a mutant
is free to be wrong there. Say a law's premise is `C.gate(n) == True{}`, and the
gate admits only `0n`, while the claim is `C.answer(n) == 0n`. A mutant that
widens the gate to admit `1n`, where `C.answer` is `1n` and the claim wants
`0n`, is a counterexample — but on the core that instance's premise is *already*
false, because the gate never admitted `1n`. So there is no instance of the law
to hold the claim against, and check 1 passes without the claim being true.
What is left is exactly what makes it a counterexample: checks 2 to 5 — the
mutant's premise holds there, the claim fails there, the proof checks
unmutated, and the proof breaks in `failsIn`. The mutant's line says the check
was vacuous:

```
  answer_zero_under_gate     PASS  false when the gate admits every value, and the answer is 1n above 0n; fails in LAWS.answer_zero_under_gate  (premise false on the core)
```

That row is the fixture's (`test/tree/group/proj`), which `sh test.sh` runs
along with `examples/plus0`.

A `counter` has no premise, so its check 1 is unconditional, as it always was.

The instance is checked in a file of its own, built from `LAWS.bend`'s imports,
so the core is in scope there under the alias the laws give it (§6) and every
other name a law's statement uses is in scope too. Check 1's
`the counterexample is false on the core itself` is therefore about the core,
not about a name the instance file failed to bring in.

A mutant with neither `at` nor `counter` is refused before any check runs:
`no counterexample: give "at" with a value for each of the law's binders, or
"counter" with a claim of your own`.

Checks 1 to 5 print one line per mutant as they run:

```
  plus0_same                 PASS  false when plus0 adds one; fails in LAWS.plus0_same
```

A mutant whose counterexample is written by hand says so on its line:

```
  shift_same                 PASS  false when the step adds two; fails in LAWS.shift_same  (counter not tied to the law)
```

and one whose check 1 was vacuous says that:

```
  answer_zero_under_gate     PASS  false when the gate admits every value, and the answer is 1n above 0n; fails in LAWS.answer_zero_under_gate  (premise false on the core)
```

and the run ends with

```
PASS: all 4 mutants are false laws, and break the proof they target
```

or, with a non-zero exit,

```
FAIL: 1 of 4 mutants did not break the proof they target
```

Read the count as "1 of the 4 mutants failed".

---

## 6. The counterexample: `at`, and `counter`

A counterexample is **an instance of the law at literals**. You do not write it
out: `at` gives each of the law's binders a Bend expression, the tool reads the
law's statement out of `LAWS.bend`, and puts the values in.

```bend
law plus0_same:
  for n: Nat
  {C.plus0(n) == n : Nat}
```

```jsonc
"at": { "n": "0n" }      // the instance is {C.plus0(0n) == 0n : Nat}
```

Pick the smallest literal that separates the two cores. If the mutant turns
`plus0` into `Nat.add(n, 1n)`, `0n` does: the instance holds on the core and
fails on the mutant. One literal is usually enough.

An equality between two `Nat`s is one claim shape, not the only one. A law whose
claim is `Bool`-valued is read the same way:

```bend
law plus0_agree:
  for +n: Nat
  {Nat.is_eq(C.plus0(n), C.plus0_slow(n)) == True{} : Bool}
```

```jsonc
"at": { "n": "0n" }      // the instance is {Nat.is_eq(C.plus0(0n), C.plus0_slow(0n)) == True{} : Bool}
```

Nothing about the table changes with the type: `at` substitutes names in the
claim and in the premises, and the instance file closes by `{==}` as before. A
Bool law's *proof* is an ordinary proof — this one rewrites with `cmp_refl_r`,
which lives in `examples/plus0/PROOF.bend`'s tools section, and with `add_zero`
— and its mutant mutates `plus0` so the two spellings stop agreeing, a
disagreement `0n` separates.

The tool writes the instance into a file of its own as

```bend
def counter() -> <the instantiated claim>:
  {==}
```

so both sides must reduce to the same term on the core, and must not on the
mutant. There is no hypothesis, no variable, and no proof: `{==}` closes it or
it does not.

### The substitution rule, exactly

Each value replaces the binder's **name**, everywhere that name stands alone in
the law's claim and in the law's premises:

- `{"n": "0n"}` on `{C.plus0(n) == n : Nat}` gives `{C.plus0(0n) == 0n : Nat}`.
- **A name is not replaced inside a longer word, or inside a string literal.**
  Binder `n` does not touch `Nat`, `2n`, or `"n"` — a name is read as the whole
  run of letters, digits and `_` it stands in.
- **The mark is not part of the name**, so the mark stays where the claim puts
  it. `for ~rule: Nat -> C.Raw -> Maybe<&2, C.Err>` with
  `{"rule": "C.no_rule"}` gives `~C.no_rule`, and `for +s: C.Schema` with
  `{"s": "C.SNat{}"}` gives `C.SNat{}`.
- **Every value goes in at once**, so a value that itself reads a binder's name
  is not substituted again.
- **The law's mark, and only it, decides what the proof def's parameters are**;
  `at` never has to mention `~`, `+` or `-`.

### What `at` has to name

- **Every binder that is not a premise needs a value.** A missing one is
  refused with `at gives no value for the binder "n" of plus0_same`; a name the
  law does not bind is refused with
  `at names "m", which the law plus0_same does not bind`.
- **A value names the core the way `LAWS.bend` does.** The instance file is
  built, not copied, and it imports the core under the alias the laws give it:
  a law written in a file that says `import ./core.bend as Core` is checked as
  `Core.plus0(0n) == 0n`, and one whose file says `import ./core.bend as C` is
  checked as `C.plus0(0n) == 0n`, as before. The alias is read from the laws'
  own `import ./core.bend as <alias>` line, so a project can name its core
  whatever it likes: a law that says `Core.` is checked as `Core.`, not refused
  as a name that is not in scope. What the values in `at` name the core with is
  the same alias: `{"n": "0n"}` needs no module, but a value of the core's own
  type does, and it has to be written the way the law's file writes it.
- **A binder the claim reads needs a value too**, whatever kind it is:
  `the claim of uses_premise mentions "h", and at gives no value for it`.
- **A binder whose type is a `{...}` equation is a premise**, and needs no
  value of its own. `at` instantiates its equation from the same values, and
  the equation must hold on the **mutant** — otherwise the instance is not one
  the law is about, and the run says so:
  `the law's premise "h" is false on the mutant, so this instance is not a
  counterexample: <premise>`. A premise that is false on the **core** is not a
  refusal: it makes check 1 vacuous, and the run's line says so (§5). A law
  whose proof rewrites with a premise is still a law `at` states, as long as the
  claim does not read the premise's own name.

### `counter`: the fallback

A few law shapes cannot be stated this way, and then `counter` holds a claim of
your own — the old way:

```jsonc
"counter": "{C.plus0(0n) == 0n : Nat}"
```

It is checked the same way (it must hold on the core and fail on the mutant),
but nothing ties it to the law, and **every line the run prints for that mutant
ends with `(counter not tied to the law)`** so the gap is visible.

Reach for it when:

- **the law's claim is not a `{...}` equation.** `at` reads a claim of that
  shape and refuses anything else:
  `law enum_admits: at needs a claim of the form {... : T}, and this law's
  statement goes on with "OneOf(ns, x)\n\n"; give "counter" instead`.
- **a binder's type names another binder, and no value of it can be written**
  for the case the mutant is about — `for +x: C.Meaning(s)`, where the schema
  the mutant concerns has no writable meaning.
- **the claim reads a premise's proof term.** `for h: {C.wf(s) == True{} : Bool}`
  is a value `at` can instantiate, but a claim like `{C.dec(s, enc(s, x)) ==
  f(h) : T}` reads `h` itself, and there is no literal to put there:
  `the claim of <law> mentions "h", and at gives no value for it`.
- **the mutation moves the premise and the claim still holds on the mutant.**
  Then no instance of the law is false on the mutant, and what you are stating
  is the premise:

  ```jsonc
  // decode_encode, whose mutation drops a conjunct of wf: dec and enc never
  // read wf, so the round trip still holds -- the premise is what moved
  "counter": "{C.wf(C.SField{\"a\", C.SNat{}, C.SField{\"a\", C.SNat{}, C.SEnd{}}}) == False{} : Bool}"
  ```

  This is not the same case as a mutant that *admits* a value the law never
  covered and gets that value wrong: there the claim is false on the mutant, so
  the row is an `at` instance, and check 1 is vacuous on the core. §5 has it.

So: `at` takes any claim of the form `{... : T}`, whatever `T` is — `Nat`,
`Bool`, `Cmp`, a `Maybe`. `counter` takes a claim of any shape at all, at the
price of no longer being tied to the law.

Rules for a `counter`:

- **`C` is `core.bend`.** The instance file is built, not copied: it starts with
  `import Base` and `import ./core.bend as C`, then carries **every other import
  `LAWS.bend` has**, verbatim — the alias and all. So a claim may name `C`, and
  may name anything else the laws import by its alias. A `counter` is written
  by hand and names the core `C` **whatever the laws call it** — that is the one
  place the two kinds of counterexample differ, since an `at` instance is
  checked under the laws' own alias (the rule above).
  Those two lines are **not** repeated: an import of `Base`, or of
  `./core.bend`, in `LAWS.bend` is dropped from the copy, so `Base` and the core
  each appear exactly once whatever the laws import. The test is the import's
  path: `import Base as B` is dropped as well. (Two names for one file, and
  `import Base` twice, both check on bend 2.0.28 — measured — but the file
  imports each once, so a run does not rest on either.)
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
    at: { n: "0n" },
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
same idea as a mutant's counterexample, many at once, and it does not need
`PROOF.bend` or `LAWS.bend`.

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
| `COUNTEREXAMPLE <name>: expected <E> / observed <O>` | the instance `<name>` is false, and `<E>` is its **left** side with `<O>` its right. The claim `{C.plus0(3n) == 4n : Nat}` prints `COUNTEREXAMPLE plus0_three: expected 3n / observed 4n`: `3n` is what `C.plus0(3n)` evaluates to, `4n` is what the claim's right side says. So `observed` is your claim's right-hand side, not a description of a fault |
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
| `no counterexample: give "at" with a value for each of the law's binders, or "counter" with a claim of your own` | the mutant has neither field |
| `no law "<name>" in LAWS.bend` | the mutant's `law` does not name a `law <name>:` block |
| `law <name>: at needs a claim of the form {... : T}, and this law's statement goes on with "<snippet>"; give "counter" instead` | the law's claim is not an equation — a witness type like `OneOf(ns, x)`, say — so `at` cannot state an instance of it |
| `at gives no value for the binder "<b>" of <law>` | `at` leaves a binder out |
| `at names "<k>", which the law <law> does not bind` | a key of `at` is not one of the law's binders |
| `the claim of <law> mentions "<b>", and at gives no value for it` | the claim reads a binder `at` has no value for — a premise's own name is the usual one |
| `the premise "<h>" of <law> mentions "<b>", and at gives no value for it` | a premise reads a binder `at` has no value for |
| `the counterexample is false on the core itself: <claim>` | the claim does not hold before the mutation, and every premise the instance carries holds there — so the instance is not one the law covers. With `at` this is the claim the tool built: a value of the wrong type, or a law that is false where you instantiated it. A premise that is false on the **core** does not produce this: check 1 is vacuous then, and the line says so (§5). A name that is not in scope is not a cause any more for `at` — the instance file imports the core under the alias `LAWS.bend` gives it (§6) — but it is for a `counter`, which names the core `C`: a counter that says `Core.` while its file imports the core as `C` fails here |
| `the law's premise "<h>" is false on the mutant, so this instance is not a counterexample: <premise>` | the instance does not satisfy the law's hypothesis after the mutation, so the law says nothing about it |
| `the counterexample still holds on the mutant, so the law is not shown false: <claim>` | the mutation does not change that instance; pick literal values the mutation moves |
| `the proof does not check even unmutated (<location>)` | the proof needs a section the run dropped — name it in `with` — or it was already broken |
| `still checks when <why>` | the proof passes against the mutated core, so it does not depend on that line. Usual causes: the mutant targets a different def from the law's, or the proof is not connected to the core |
| `failed in <loc>, not <failsIn>, when <why>` | the proof broke, but in another def. `<loc>` is the truth; put it in `failsIn`. `<loc>` is `?` when the checker has no location: the mutated core does not compile, so `to` is not valid Bend |

**Errors that stop the run at once** (no per-mutant line, and the summary line
is not printed)

| message | cause |
| --- | --- |
| `FAIL: <file>: import <rel> does not exist: <abs>` | an import of `core.bend`, `LAWS.bend` or `PROOF.bend` names nothing on disk. Reported before any check, with the file that makes the import |
| `FAIL: PROOF.bend: duplicate section header "# ---- <name> ----" (lines <a>, <b>); give each section its own name` | two `# ---- <name> ----` headers are identical. Both sections would be kept under one name and their text concatenated, so the proof would break somewhere that names neither. Every line the repeated header sits on is listed |
| `<law>: no section "<section>" in PROOF.bend` | no `# ---- <section> ----` header with that exact text. Usually a header that does not match the format, or a `section` copied from another law |
| `no mutant has the section "<sec>", so its law is unknown` | a `with` entry that names a section no mutant in the table has. Every name in `with` must be some row's `section` |
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
`core/check_mutants.ts` (a table of 29 mutants) and `core/falsify/spec.ts` (a
spec that generates its instances, and takes `CORE=` to point at a mutated
core).

The example beside this file: `examples/plus0/` — four laws, one of them
Bool-valued, four mutants, one of them proved `with` another, and a spec of
three instances. `sh test.sh` runs all of it.
