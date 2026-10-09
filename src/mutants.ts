// Every law's proof has to fail when the law is made false -- and the law has
// to be false, shown by a counterexample, not asserted.
//
// For each mutant: write the project's core, laws and proof into a scratch
// directory inside the project, keep only the tools and one law's section of PROOF.bend, and check:
//
//   1. the counterexample holds on the core as it is      (the claim is true)
//      -- where the law applies: if every premise the instance carries holds
//      on the core, the claim must hold too. A premise that is false on the
//      core makes the check vacuous, and the mutant's line says so
//   2. the law's premises, instantiated, hold on the mutant (the instance is
//      one the law is about)
//   3. the counterexample fails on the mutated core       (the law is false)
//   4. the proof checks on the core as it is              (the control)
//   5. the proof fails on the mutated core, in `failsIn`  (it depends on it)
//
// Checks 1 to 3 make `why` a checked claim: a proof that fails on a mutant
// where the law still holds would otherwise count as a kill. A proof that
// still checks against a false law would be saying nothing about the core.
//
// Check 1 is conditional for an `at` instance because a mutant can move a
// law's premise rather than its claim: a mutant that strengthens `wf` admits a
// value the law never covered, the claim is false there, and the core's
// premise was false there too -- so there is no instance of the law to check
// the claim against, and the row is still a counterexample. A `counter`
// carries no premise, so its check 1 is unconditional.
//
// The counterexample is an instance of the law, not a claim of its own: the
// mutant names the law's binders at literals (`at`), and the tool reads the
// law's statement from LAWS.bend and puts the values in. A counter written by
// hand (`counter`) is still accepted for a law shape `at` cannot express, and
// its report line says that nothing ties it to the law.
//
// The instance file for an `at` row is LAWS.bend's own text with every law
// removed, so an `at` instance is written in the laws' own namespace: the core
// under whatever alias the laws import it as, and every def LAWS.bend declares
// -- a claim typed `Q()`, a premise typed `R()`. A hand-written `counter` is a
// file built from the laws' imports alone: it names the core `C`, and no def of
// LAWS.bend is in scope for it.
//
// Isolating one section per law matters: the checker stops at the first
// failing def, and proofs over the same definitions break together, so a mutant
// run against the whole file would be blamed on whichever proof comes first.
//
// The scratch directory is `bend_mutant_<random>`, a plain name (bend refuses
// an import path with any other kind), inside the project directory. A row
// writes the three files into it, under their own names, plus every file that
// transitively imports the project's core.bend (under chain/, wherever the
// file lives), so the mutant and the original are never two modules. Their
// relative imports are rewritten to point at the scratch files where there is
// one and at the real tree everywhere else. Nothing else is written or copied.
//
// A project calls runMutants(projectDir, MUTANTS) from its own table file.
// It expects core.bend, LAWS.bend and PROOF.bend in projectDir, and a PROOF.bend
// whose shared lemmas sit under a header containing "tools".
//
// A law proved from other laws cannot be checked alone: its mutant names their
// sections in `with`, and the run keeps those sections and their laws too.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface Mutant {
  law: string;
  section: string; // the "# ---- <section> ----" header in PROOF.bend
  from: string; // a line of core.bend, replaced whole
  to: string;
  why: string; // why the law is false afterwards, in words
  // The law's binders, each with the Bend expression that stands for it -- e.g.
  // { n: "3n" }. The tool reads the law's statement from LAWS.bend and builds
  // the instance from it, so a counterexample cannot be a claim that is not the
  // law. A value replaces the binder's *name*: the mark stays where the claim
  // puts it, so `for ~rule: ...` with { rule: "C.no_rule" } is `~C.no_rule`.
  at?: Record<string, string>;
  // A claim of its own, for a law shape `at` cannot express -- one whose claim
  // uses a premise's proof term, or whose premise is what the mutant makes
  // false. It is checked the same way, but nothing ties it to the law, and the
  // report says so. `at` is what you want everywhere else.
  counter?: string;
  failsIn: string; // the def the checker must name
  // When `from` occurs more than once in core.bend, which occurrence (1 =
  // first). Without it a repeated line is refused: the mutant would be
  // ambiguous.
  nth?: number;
  // Other laws' sections this proof builds on, kept (with their laws) in the
  // run. A law proved from other laws cannot be checked alone.
  with?: string[];
}

// 5 s, as bend-check: a check that runs longer is a problem to fix (a large
// constant, a fuel loop, application code in a goal), not a limit to raise.
const LIMIT_MS = 5000;

// PROOF.bend as its head (imports) and its "# ---- name ----" sections.
export function sections(text: string): { head: string; secs: [string, string][] } {
  const parts = text.split(/^(# ---- .* ----)$/m);
  const secs: [string, string][] = [];
  for (let i = 1; i < parts.length; i += 2) secs.push([parts[i], parts[i + 1]]);
  return { head: parts[0], secs };
}

// Where PROOF.bend declares a def: the header of its section, "" for the head
// (before the first header), or undefined when no section declares it (a
// law's proof def such as Laws.x, named as written in PROOF.bend).
export function sectionOf(text: string, def: string): string | undefined {
  const { head, secs } = sections(text);
  const declares = (body: string): boolean =>
    new RegExp(`^def ${def.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.])`, "m").test(body);
  if (declares(head)) return "";
  return secs.find(([, b]) => declares(b))?.[0];
}

// A failsIn in shared code -- the head, or a section every run keeps because
// its header says "tools" -- does not tell one law's mutant from another's:
// any mutation that breaks that lemma fails there. The run still passes such a
// row, and says so on its line.
export function failsInShared(text: string, def: string): boolean {
  const sec = sectionOf(text, def);
  return sec === "" || (sec !== undefined && sec.includes("tools"));
}

// The section headers a file repeats, with every line each one sits on. Two
// sections under one name are kept together -- their text is concatenated --
// so the proof breaks somewhere that names neither; the run refuses them by
// name and line instead.
export function duplicateSections(text: string): { header: string; lines: number[] }[] {
  const seen = new Map<string, number[]>();
  text.split("\n").forEach((line, i) => {
    if (/^# ---- .* ----$/.test(line)) seen.set(line, [...(seen.get(line) ?? []), i + 1]);
  });
  return [...seen].map(([header, lines]) => ({ header, lines })).filter((d) => d.lines.length > 1);
}

// LAWS.bend with every law but the kept ones removed; its types, defs and
// imports stay. A block runs from one top-level form to the next, so each form
// that may follow a law has to start a block of its own.
export function onlyLaws(text: string, keep: string[]): string {
  return text
    .split(/^(?=law |# ---- |def |type |import )/m)
    .filter((b) => !b.startsWith("law ") || keep.some((k) => b.startsWith(`law ${k}:`)))
    .join("");
}

// Replace exactly one whole line of the core, or refuse: a mutation that does
// not apply would make the mutant identical to the control.
export function mutate(text: string, from: string, to: string, law: string, nth?: number): string {
  const lines = text.split("\n");
  const hits = lines.flatMap((l, i) => (l === from ? [i] : []));
  if (hits.length === 0) throw new Error(`${law}: the line to mutate is not in core.bend: ${JSON.stringify(from)}`);
  if (nth === undefined && hits.length > 1) {
    throw new Error(`${law}: the line to mutate occurs ${hits.length} times in core.bend (lines ${hits.map((i) => i + 1).join(", ")}); say which with nth: ${JSON.stringify(from)}`);
  }
  const hit = hits[(nth ?? 1) - 1];
  if (hit === undefined) throw new Error(`${law}: nth ${nth}, but the line occurs ${hits.length} times in core.bend: ${JSON.stringify(from)}`);
  lines[hit] = to;
  return lines.join("\n");
}

// ---- what a project imports ---------------------------------------------

// The three files a row writes into the scratch directory under their own
// names; the root of every scratch import graph.
const OWN = /^\.\/(core|LAWS|PROOF)\.bend$/;
const ROOTS = ["core.bend", "LAWS.bend", "PROOF.bend"];

// The relative import paths (`./x`, `../x`) of a text, in order, once each.
export function relativeImports(text: string): string[] {
  const paths: string[] = [];
  for (const m of text.matchAll(/^import (\.\.?\/\S*)/gm)) if (!paths.includes(m[1])) paths.push(m[1]);
  return paths;
}

function realOr(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

// The relative imports of the three files that name nothing on disk. A run
// stops on them by name, before any check: from the scratch directory they
// would surface as a counterexample that is false on the core, which is not
// what happened.
export function missingImports(projectDir: string, sources: [string, string][]): { file: string; rel: string; abs: string }[] {
  return sources
    .flatMap(([file, text]) => relativeImports(text).filter((p) => !OWN.test(p)).map((rel) => ({ file, rel, abs: resolve(projectDir, rel) })))
    .filter((s) => !existsSync(s.abs));
}

// A file on an import chain from the three files to the original core.bend.
// It is written into the scratch directory as `chain/<name>`.
export interface ChainFile { real: string; name: string; text: string }

// Where each real file the scratch files import is placed in the scratch
// directory (the path inside it): the three files, and every file that
// transitively imports the project's core.bend -- the mutant and the original
// would otherwise be two modules. Files that do not reach the core are not in
// the map and are imported from the real tree.
export interface ImportPlan { places: Map<string, string>; chain: ChainFile[]; problems: string[] }

// Walk the import graph from the three files over the real tree, read-only
// (each file once), and find the files that reach the core.
export function planImports(projectDir: string, sources: [string, string][]): ImportPlan {
  const base = realOr(projectDir);
  const places = new Map<string, string>(ROOTS.map((n) => [realOr(join(base, n)), n]));
  const nodes = new Map<string, { text: string; deps: string[] }>();
  const problems: string[] = [];
  const collect = (file: string, text: string, dir: string): string[] => {
    const deps: string[] = [];
    for (const p of relativeImports(text)) {
      const target = realOr(resolve(dir, p));
      if (!existsSync(target)) { problems.push(`${file}: import ${p} does not exist: ${target}`); continue; }
      deps.push(target);
      if (nodes.has(target) || places.has(target)) continue;
      let body: string;
      try { body = readFileSync(target, "utf8"); } catch { continue; } // a directory: nothing to read
      nodes.set(target, { text: body, deps: [] });
      nodes.get(target)!.deps = collect(target, body, dirname(target));
    }
    return deps;
  };
  for (const [name, text] of sources) collect(name, text, base);
  // A file reaches the core when it imports a root or a file that does.
  const reaches = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const [real, node] of nodes) {
      if (!reaches.has(real) && node.deps.some((d) => places.has(d) || reaches.has(d))) { reaches.add(real); grew = true; }
    }
  }
  const chain: ChainFile[] = [];
  for (const real of reaches) {
    const stem = (real.split("/").pop() ?? "f").replace(/\.bend$/, "").replace(/[^A-Za-z0-9_-]/g, "_");
    const name = `${stem}_${chain.length}.bend`;
    chain.push({ real, name, text: nodes.get(real)!.text });
    places.set(real, `chain/${name}`);
  }
  return { places, chain, problems };
}

// `text`, a file whose real directory is `fromDir` and which sits in
// `toDir`, with each relative import pointed at the scratch copy of its target
// where there is one (the three files and the chain), and at the real file
// otherwise. `scratchDir` is the row's scratch directory.
export function rewriteImports(text: string, plan: ImportPlan, scratchDir: string, fromDir: string, toDir: string): string {
  return text.replace(/^import (\.\.?\/\S*)/gm, (_line, p: string) => {
    const target = realOr(resolve(fromDir, p));
    const place = plan.places.get(target);
    const rel = relative(toDir, place === undefined ? target : join(scratchDir, place));
    return `import ${rel.startsWith("..") ? rel : `./${rel}`}`;
  });
}

// ---- scratch directories -------------------------------------------------

// Every scratch directory of this process that still exists. They are removed
// when a row finishes; this set is for the exits that skip that: a signal, an
// uncaught error, process.exit inside a try.
const live = new Set<string>();
let hooked = false;
function removeLive(): void {
  for (const d of live) rmSync(d, { recursive: true, force: true });
  live.clear();
}
function hook(): void {
  if (hooked) return;
  hooked = true;
  process.on("exit", removeLive);
  for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.on(sig, () => {
      removeLive();
      // A caller with its own handler (the CLI's) does its own teardown.
      if (process.listenerCount(sig) === 1) process.exit(code);
    });
  }
}

// Leftovers of a run that died without cleaning up.
function sweep(projectDir: string): void {
  for (const e of readdirSync(projectDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith("bend_mutant_")) rmSync(join(projectDir, e.name), { recursive: true, force: true });
  }
}

// ---- the law, and the instance of it a mutant names ---------------------

export interface Binder {
  name: string;
  mark: string; // ~, + or - as written, "" when unmarked
  type: string;
  premise: boolean; // its type is a `{...}` equation: the law holds under it
}

export interface Law {
  name: string;
  binders: Binder[];
  claim: string; // the `{...}` the law states
}

export interface Instance {
  claim: string;
  premises: { binder: string; equation: string }[];
}

// The name of the binder a `for` clause opens, or null.
const BINDER = /^for\s*([~+-]?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/;

// The `{...}` that starts at `i`, and the index just past it. A brace inside a
// string literal does not count.
function braces(text: string, i: number, law: string): { text: string; end: number } {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === '"') { j = stringEnd(text, j); continue; }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return { text: text.slice(i, j + 1), end: j + 1 };
    }
    j += 1;
  }
  throw new Error(`law ${law}: unbalanced "{": ${JSON.stringify(text.slice(i, i + 40))}`);
}

// The index just past the string literal that opens at `i`.
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') {
    if (text[j] === "\\") j += 1;
    j += 1;
  }
  return Math.min(j + 1, text.length);
}

// Walk the text and let `f` stand in for each identifier that stands alone in
// it. A name inside a longer word is not a name (n is not Nat, nor 2n), and a
// name inside a string literal is not a name ("a" is not the binder a).
function rewrite(text: string, f: (id: string) => string | null): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const j = stringEnd(text, i);
      out += text.slice(i, j);
      i = j;
      continue;
    }
    const m = /^[A-Za-z0-9_]+/.exec(text.slice(i));
    if (m) {
      out += f(m[0]) ?? m[0];
      i += m[0].length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// Every binder name the text reads, outside string literals.
function mentions(text: string, name: string): boolean {
  let found = false;
  rewrite(text, (id) => {
    if (id === name) found = true;
    return null;
  });
  return found;
}

// `text` with each binder name replaced by its value. Every value goes in at
// once, so a value that reads a binder's name is not substituted again.
export function substitute(text: string, values: Record<string, string>): string {
  return rewrite(text, (id) => values[id] ?? null);
}

// The law as LAWS.bend states it: its binders -- a premise is a binder whose
// type is a `{...}` equation -- and its claim. Refuses a law it cannot read
// exactly rather than guessing at one.
export function readLaw(lawsText: string, name: string): Law {
  const head = `law ${name}:`;
  const block = lawsText.split(/^(?=law |# ---- |def )/m).find((b) => b.startsWith(head));
  if (block === undefined) throw new Error(`no law "${name}" in LAWS.bend`);
  const rest = block.slice(head.length);
  const binders: Binder[] = [];
  let claim = "";
  let i = 0;
  const space = (): void => {
    while (i < rest.length && /[\s,]/.test(rest[i])) i += 1;
  };
  while (i < rest.length) {
    space();
    if (i >= rest.length) break;
    if (rest[i] === "{") {
      const g = braces(rest, i, name);
      claim = g.text;
      break;
    }
    const m = BINDER.exec(rest.slice(i));
    if (!m) {
      throw new Error(`law ${name}: at needs a claim of the form {... : T}, and this law's statement goes on with ${JSON.stringify(rest.slice(i, i + 30))}; give "counter" instead`);
    }
    const [, mark, bname] = m;
    i += m[0].length;
    space();
    if (rest[i] === "{") {
      const g = braces(rest, i, name);
      binders.push({ name: bname, mark, type: g.text, premise: true });
      i = g.end;
      continue;
    }
    // A type that is not an equation runs to the next binder or to the claim,
    // whichever the layout puts next: both follow a line break or a comma.
    const start = i;
    while (i < rest.length && !/^[\s,]*(?:for\b|\{)/.test(rest.slice(i))) i += 1;
    const type = rest.slice(start, i).replace(/\s+/g, " ").trim();
    if (type === "") throw new Error(`law ${name}: the binder ${bname} has no type`);
    binders.push({ name: bname, mark, type, premise: false });
  }
  if (claim === "") throw new Error(`law ${name}: no claim in LAWS.bend`);
  return { name, binders, claim: claim.replace(/\s+/g, " ").trim() };
}

// The law at the values `at` names: its claim with every binder replaced, and
// every premise it instantiates. Refuses a partial `at` -- it must give a
// value for each binder that is not a premise, and none for a name the law
// does not bind -- because a half-substituted statement is not an instance.
export function lawInstance(law: Law, at: Record<string, string>): Instance {
  const names = law.binders.map((b) => b.name);
  for (const k of Object.keys(at)) {
    if (!names.includes(k)) throw new Error(`at names "${k}", which the law ${law.name} does not bind`);
  }
  const free = (what: string, text: string): void => {
    const missing = names.find((n) => at[n] === undefined && mentions(text, n));
    if (missing !== undefined) throw new Error(`${what} mentions "${missing}", and at gives no value for it`);
  };
  for (const b of law.binders) {
    if (!b.premise && at[b.name] === undefined) throw new Error(`at gives no value for the binder "${b.name}" of ${law.name}`);
  }
  free(`the claim of ${law.name}`, law.claim);
  const premises = law.binders
    .filter((b) => b.premise)
    .map((b) => {
      free(`the premise "${b.name}" of ${law.name}`, b.type);
      return { binder: b.name, equation: substitute(b.type, at) };
    });
  return { claim: substitute(law.claim, at), premises };
}

// The head of the file an `at` instance is checked in: LAWS.bend's own text,
// with every law removed -- its imports, its defs and its comments stay. An
// `at` instance is the law's statement as written, and a statement may name
// anything the laws' file names: the core under the alias that file imports it
// as, and any def the file declares. A head built from the imports alone leaves
// those defs out of scope, and an instance that names one is refused as a name
// that is not defined.
export function instanceHead(laws: string): string {
  return onlyLaws(laws, []);
}

// The name of the def the instance is appended as. `counter`, unless the head
// declares a def by that name -- the head is the laws' own text, so a def there
// would collide with the one appended.
export function instanceDefName(head: string): string {
  let name = "counter";
  while (new RegExp(`^def ${name}\\b`, "m").test(head)) name = `${name}_`;
  return name;
}

// The counterexample file's imports: `Base`, the core under `C`, and every
// other import LAWS.bend has, so a claim can name what a law's statement names
// (another package's error type, say). LAWS.bend's own import of the core is
// left out, and so is `Base`: each appears once, under the one name the claim
// in this file uses. (Measured on bend 2.0.28: two names for one file check
// fine, and so does `import Base` twice -- the core is imported once all the
// same, so nothing here rests on a checker's tolerance of either.)
//
// This is the head of a `counter` row only, and a `counter` names the core `C`
// whatever the laws call it. An `at` row's head is the laws' whole file
// (instanceHead above), which brings its defs and its own alias along.
export function counterImports(laws: string): string {
  const others = [...laws.matchAll(/^import (\S+)(?: as (\S+))?[ \t]*$/gm)]
    .filter(([, path]) => path !== "Base" && path !== "./core.bend")
    .map(([line]) => line);
  return ["import Base", "import ./core.bend as C", ...others].join("\n");
}

function prepareRun(projectDir: string, mutants: Mutant[]) {
  const core = readFileSync(join(projectDir, "core.bend"), "utf8");
  const laws = readFileSync(join(projectDir, "LAWS.bend"), "utf8");
  const proof = readFileSync(join(projectDir, "PROOF.bend"), "utf8");
  const sources: [string, string][] = [["core.bend", core], ["LAWS.bend", laws], ["PROOF.bend", proof]];
  // Two heads, because the two kinds of counterexample are written in two
  // namespaces. An `at` instance is the law's statement as written, so its file
  // is LAWS.bend itself with the laws removed: the core under the laws' own
  // alias, and the laws' own defs, both in scope. A hand-written `counter`
  // names the core `C` -- §6 of the README -- whatever the laws call it, and
  // its file is built from the laws' imports alone, so no def of LAWS.bend is
  // in scope for it. `def` is the name the instance is appended as, which has
  // to avoid the names the laws' own file declares.
  const atHead = instanceHead(laws);
  const atFile = { head: atHead, def: instanceDefName(atHead) };
  const counterFile = { head: counterImports(laws), def: "counter" };

  // Two sections with one name would be kept together, and their text
  // concatenated, so the proof would break somewhere that names neither:
  // refused by name and line, before any check.
  const doubles = duplicateSections(proof);
  if (doubles.length > 0) {
    for (const d of doubles) {
      console.log(`FAIL: PROOF.bend: duplicate section header ${JSON.stringify(d.header)} (lines ${d.lines.join(", ")}); give each section its own name`);
    }
    return undefined;
  }

  // Everything the scratch files import has to be there before the first
  // check: a missing import would otherwise read as a false counterexample.
  const gone = missingImports(projectDir, sources);
  if (gone.length > 0) {
    for (const g of gone) console.log(`FAIL: ${g.file}: import ${g.rel} does not exist: ${g.abs}`);
    return undefined;
  }
  const plan = planImports(projectDir, sources);
  if (plan.problems.length > 0) {
    for (const p of plan.problems) console.log(`FAIL: ${p}`);
    return undefined;
  }
  const base = realOr(projectDir);
  sweep(projectDir);
  hook();

  // Write one check's files into a fresh directory inside the project, and
  // return it with the function that removes it; the caller removes it
  // whatever happens. Only the three files (and the instance) are written,
  // with their relative imports pointed at the real tree; nothing is copied.
  function scratch(request: CheckRequest): { dir: string; remove: () => void } {
    const { coreText, lawsText = laws, proofText = proof } = request;
    const dir = mkdtempSync(join(base, "bend_mutant_"));
    live.add(dir);
    const remove = () => { live.delete(dir); rmSync(dir, { recursive: true, force: true }); };
    try {
      const put = (name: string, text: string, fromDir: string): void => {
        const path = join(dir, name);
        writeFileSync(path, rewriteImports(text, plan, dir, fromDir, dirname(path)));
      };
      put("core.bend", coreText, base);
      put("LAWS.bend", lawsText, base);
      put("PROOF.bend", proofText, base);
      if (request.instance !== undefined) put("INSTANCE.bend", request.instance, base);
      if (plan.chain.length > 0) mkdirSync(join(dir, "chain"));
      for (const f of plan.chain) put(`chain/${f.name}`, f.text, dirname(f.real));
      return { dir, remove };
    } catch (error) {
      remove();
      throw error;
    }
  }

  // Does this equation close against this core? The checker runs the code, so
  // it holds exactly when both sides reduce to the same term. `file` is the
  // instance file's head and the name the instance is appended as: the two
  // namespaces above differ in nothing else.
  function checkClaim(coreText: string, claim: string, file: { head: string; def: string }): CheckRequest {
    return { coreText, file: "INSTANCE.bend", checkOnly: true,
      instance: `${file.head}\n\ndef ${file.def}() -> ${claim}:\n  {==}\n` };
  }

  function proofChecks(coreText: string, m: Mutant, withLaws: [string, string][]): CheckRequest {
    const { head, secs } = sections(proof);
    const wanted = [m.section, ...withLaws.map(([, sec]) => sec)].map((x) => `# ---- ${x} ----`);
    const kept = secs.filter(([h]) => h.includes("tools") || wanted.includes(h));
    if (!kept.some(([h]) => h === `# ---- ${m.section} ----`)) {
      throw new Error(`${m.law}: no section "${m.section}" in PROOF.bend`);
    }
    return { coreText, file: "PROOF.bend", checkOnly: false,
      lawsText: onlyLaws(laws, [m.law, ...withLaws.map(([law]) => law)]),
      proofText: head + kept.map(([h, b]) => h + b).join("") };
  }

  // A section named in `with` is kept with the law whose section it is.
  const lawOf = (sec: string): [string, string] => {
    const owner = mutants.find((x) => x.section === sec);
    if (!owner) throw new Error(`no mutant has the section "${sec}", so its law is unknown`);
    return [owner.law, sec];
  };
  function* row(m: Mutant): Generator<CheckRequest, RowResult, CheckResult> {
    const name = m.law.padEnd(26);
    // A counter written by hand is not read from the law: every line about it
    // says so, or the gap goes unnoticed.
    const loose = m.counter !== undefined && m.at === undefined ? "  (counter not tied to the law)" : "";
    const fail = (msg: string): RowResult => ({ line: `  ${name} FAIL  ${msg}${loose}`, bad: true });

    let claim: string;
    let premises: Instance["premises"] = [];
    let file = counterFile;
    if (m.at !== undefined) {
      file = atFile;
      try {
        const inst = lawInstance(readLaw(laws, m.law), m.at);
        claim = inst.claim;
        premises = inst.premises;
      } catch (e) {
        return fail((e as Error).message);
      }
    } else if (m.counter) {
      claim = m.counter;
    } else {
      return fail(`no counterexample: give "at" with a value for each of the law's binders, or "counter" with a claim of your own`);
    }

    let mutated: string;
    try {
      mutated = mutate(core, m.from, m.to, m.law, m.nth);
    } catch (e) {
      return fail((e as Error).message);
    }
    const withLaws = (m.with ?? []).map(lawOf);

    // Check 1, conditional for an instance: the law says nothing where its own
    // premise is false, so a mutant that makes the premise false on the core
    // leaves nothing for the claim to hold against. Checks 2 to 5 still run,
    // so the row stays a checked claim. A `counter` carries no premise.
    let falseOnCore: Instance["premises"][number] | undefined;
    for (const p of premises) {
      if (!(yield checkClaim(core, p.equation, file)).ok) { falseOnCore = p; break; }
    }
    if (falseOnCore === undefined && !(yield checkClaim(core, claim, file)).ok) {
      return fail(`the counterexample is false on the core itself: ${claim}`);
    }
    let falsePremise: Instance["premises"][number] | undefined;
    for (const p of premises) {
      if (!(yield checkClaim(mutated, p.equation, file)).ok) { falsePremise = p; break; }
    }
    if (falsePremise) {
      return fail(`the law's premise "${falsePremise.binder}" is false on the mutant, so this instance is not a counterexample: ${falsePremise.equation}`);
    }
    if ((yield checkClaim(mutated, claim, file)).ok) {
      return fail(`the counterexample still holds on the mutant, so the law is not shown false: ${claim}`);
    }
    const control = yield proofChecks(core, m, withLaws);
    if (!control.ok) {
      return fail(`the proof does not check even unmutated (${control.location})`);
    }
    const mutant = yield proofChecks(mutated, m, withLaws);
    if (mutant.ok) {
      return fail(`still checks when ${m.why}`);
    }
    if (mutant.location !== m.failsIn) {
      return fail(`failed in ${mutant.location}, not ${m.failsIn}, when ${m.why}`);
    }
    const shared = failsInShared(proof, m.failsIn) ? "  (fails in a shared lemma, not the law's own section)" : "";
    return { line: `  ${name} PASS  false when ${m.why}; fails in ${m.failsIn}${loose}${falseOnCore ? "  (premise false on the core)" : ""}${shared}`, bad: false };
  }
  return { row, scratch };
}

interface CheckRequest {
  coreText: string;
  file: string;
  checkOnly: boolean;
  instance?: string;
  lawsText?: string;
  proofText?: string;
}
interface CheckResult { ok: boolean; location: string }
interface RowResult { line: string; bad: boolean }

function verdict(out: string): CheckResult {
  return { ok: /^ALL PROOFS CHECK$/m.test(out), location: out.match(/^Location: (\S+)/m)?.[1] ?? "?" };
}
function timeoutError(file: string): Error {
  return new Error(`${file}: the checker ran past ${LIMIT_MS / 1000} s: a problem to fix, not a limit to raise`);
}
function summary(bad: number, count: number): void {
  console.log(bad > 0
    ? `FAIL: ${bad} of ${count} mutants did not break the proof they target`
    : `PASS: all ${count} mutants are false laws, and break the proof they target`);
}

// The synchronous API retains its exit-on-failure contract.
export function runMutants(projectDir: string, mutants: Mutant[]): void {
  const run = prepareRun(projectDir, mutants);
  if (!run) process.exit(1);
  let bad = 0;
  for (const m of mutants) {
    const row = run.row(m);
    let step = row.next();
    while (!step.done) {
      const request = step.value;
      const scratch = run.scratch(request);
      let result: CheckResult;
      try {
        const r = Bun.spawnSync(["bend", request.file, ...(request.checkOnly ? ["--check-only"] : [])], { cwd: scratch.dir, timeout: LIMIT_MS });
        if (r.exitedDueToTimeout) throw timeoutError(request.file);
        if (r.signalCode) throw new Error(`${request.file}: checker stopped by ${r.signalCode}`);
        result = verdict(r.stdout.toString() + r.stderr.toString());
      } finally {
        scratch.remove();
      }
      step = row.next(result);
    }
    console.log(step.value.line);
    if (step.value.bad) bad++;
  }
  summary(bad, mutants.length);
  if (bad > 0) process.exit(1);
}

export interface MutantRunOptions {
  jobs?: number;
  signal?: AbortSignal;
}

// A worker owns an entire row. Checks within it never overlap; each check
// owns fresh scratch until its child has exited and its output is drained.
// Semantic failures set exitCode after every row completes. Operational
// errors reject only after all workers have stopped and removed scratch.
export async function runMutantsAsync(projectDir: string, mutants: Mutant[], options: MutantRunOptions = {}): Promise<void> {
  const jobs = options.jobs ?? 1;
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error("jobs must be a positive integer");
  options.signal?.throwIfAborted();
  const run = prepareRun(projectDir, mutants);
  if (!run) { process.exitCode = 1; return; }
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  let next = 0;
  let printed = 0;
  let bad = 0;
  const results: (RowResult | undefined)[] = new Array(mutants.length);

  async function check(request: CheckRequest): Promise<CheckResult> {
    controller.signal.throwIfAborted();
    const scratch = run!.scratch(request);
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const stop = () => { child?.kill("SIGKILL"); };
    try {
      child = Bun.spawn(["bend", request.file, ...(request.checkOnly ? ["--check-only"] : [])], {
        cwd: scratch.dir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      controller.signal.addEventListener("abort", stop, { once: true });
      timer = setTimeout(() => { timedOut = true; stop(); }, LIMIT_MS);
      const [out, err] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      if (timedOut) throw timeoutError(request.file);
      controller.signal.throwIfAborted();
      if (child.signalCode) throw new Error(`${request.file}: checker stopped by ${child.signalCode}`);
      return verdict(out + err);
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.signal.removeEventListener("abort", stop);
      try {
        if (child) { child.kill("SIGKILL"); await child.exited; }
      } finally {
        scratch.remove();
      }
    }
  }

  async function worker(): Promise<void> {
    try {
      for (let i = next++; i < mutants.length; i = next++) {
        controller.signal.throwIfAborted();
        const row = run!.row(mutants[i]);
        let step = row.next();
        while (!step.done) step = row.next(await check(step.value));
        results[i] = step.value;
        // Only a completed prefix may print: a faster later row cannot
        // reorder output, including rows that need no checker at all.
        while (results[printed] !== undefined) {
          const result = results[printed++]!;
          console.log(result.line);
          if (result.bad) bad++;
        }
      }
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  }
  try {
    await Promise.allSettled(Array.from({ length: Math.min(jobs, mutants.length) }, worker));
    controller.signal.throwIfAborted();
    summary(bad, mutants.length);
    if (bad > 0) process.exitCode = 1;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}
