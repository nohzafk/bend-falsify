// Every law's proof has to fail when the law is made false -- and the law has
// to be false, shown by a counterexample, not asserted.
//
// For each mutant: copy the project's core, laws and proof into a scratch
// tree, keep only the tools and one law's section of PROOF.bend, and check:
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
// The instance file imports the core under the alias LAWS.bend gives it, so an
// `at` instance is written in the laws' own namespace: a law that says `Core.`
// is checked against `Core.`, whatever alias the laws chose. A hand-written
// `counter` names the core `C`, and its file imports it as `C`.
//
// Isolating one section per law matters: the checker stops at the first
// failing def, and proofs over the same definitions break together, so a mutant
// run against the whole file would be blamed on whichever proof comes first.
//
// The scratch tree mirrors the project's place in the filesystem as deep as
// its relative imports climb: a project that imports ../../bend-schema/x is
// placed two directories below the scratch root, under its real ancestors'
// names, so every import resolves inside the scratch tree. Nothing outside
// the project and the imports it names is copied, and nothing lands outside
// the scratch root.
//
// A project calls runMutants(projectDir, MUTANTS) from its own table file.
// It expects core.bend, LAWS.bend and PROOF.bend in projectDir, and a PROOF.bend
// whose shared lemmas sit under a header containing "tools".
//
// A law proved from other laws cannot be checked alone: its mutant names their
// sections in `with`, and the run keeps those sections and their laws too.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

// LAWS.bend with every law but the kept ones removed; its defs stay.
export function onlyLaws(text: string, keep: string[]): string {
  return text
    .split(/^(?=law |# ---- |def )/m)
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

// ---- what a project imports from outside itself -------------------------

export interface ImportSite {
  file: string; // the file that makes the import: core.bend, LAWS.bend, PROOF.bend
  rel: string; // what is mirrored, relative to the project directory
}

// The outward imports of the given [file, text] pairs. An import that climbs
// out, `../<name>` at any depth, is mirrored: `<name>` as it stands, which is
// a directory when the import goes on into it (`../lib/facts.bend` copies
// `../lib`) and the file itself when it does not (`../shared.bend`).
// The project directory is copied whole, so an import inside it needs nothing
// here. `import Base` names no path.
export function importSites(sources: [string, string][]): ImportSite[] {
  const sites: ImportSite[] = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/^import ((?:\.\.\/)+)([^/\s]+)(?=[/\s]|$)/gm)) {
      const rel = `${m[1]}${m[2]}`;
      if (!sites.some((s) => s.rel === rel)) sites.push({ file, rel });
    }
  }
  return sites;
}

// How many levels deep the project has to sit in the scratch tree: the deepest
// `..` in any one outward import, and at least 1.
function depthOf(paths: string[]): number {
  return Math.max(1, ...paths.map((p) => p.split("/").filter((s) => s === "..").length));
}

export function relativeImports(texts: string[]): { paths: string[]; depth: number } {
  const paths = importSites(texts.map((text) => ["", text])).map((s) => s.rel);
  return { paths, depth: depthOf(paths) };
}

// The imports that name nothing on disk. A run stops on them by name, before
// any check: inside the scratch tree they would surface as a counterexample
// that is false on the core, which is not what happened.
export function missingImports(projectDir: string, sites: ImportSite[]): { file: string; rel: string; abs: string }[] {
  return sites
    .map((s) => ({ file: s.file, rel: s.rel, abs: resolve(projectDir, s.rel) }))
    .filter((s) => !existsSync(s.abs));
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

// The name LAWS.bend imports the core under. An `at` instance is the law's
// statement as written, so it has to import the core under the name that
// statement uses: a law written against `import ./core.bend as Core` names
// `Core.`, and an instance that imported the core as `C` would name a module
// that is not in scope there. A LAWS.bend that does not import the core names
// it nowhere, and `C` is then as good as anything.
export function coreAlias(laws: string): string {
  return /^import\s+\.\/core\.bend\s+as\s+(\S+)[ \t]*$/m.exec(laws)?.[1] ?? "C";
}

// The counterexample file's imports: the core under `alias`, and every other
// import LAWS.bend has, so a claim can name what a law's statement names
// (another package's error type, say). LAWS.bend's own import of the core is
// left out, and so is `Base`: each appears once, under the one name the claim
// in this file uses. (Measured on bend 2.0.28: two names for one file check
// fine, and so does `import Base` twice -- the core is imported once all the
// same, so nothing here rests on a checker's tolerance of either.)
export function counterImports(laws: string, alias = "C"): string {
  const others = [...laws.matchAll(/^import (\S+)(?: as (\S+))?[ \t]*$/gm)]
    .filter(([, path]) => path !== "Base" && path !== "./core.bend")
    .map(([line]) => line);
  return ["import Base", `import ./core.bend as ${alias}`, ...others].join("\n");
}

// Where the project sits in the scratch tree: under its own last `depth`
// ancestors' names, so "../".repeat(depth) climbs exactly to the root.
export function placeProject(root: string, projectDir: string, depth: number): string {
  const abs = resolve(projectDir);
  const parts = abs.split(sep).filter(Boolean);
  if (parts.length <= depth) throw new Error(`${abs}: imports climb ${depth} levels, past the filesystem root`);
  return join(root, ...parts.slice(parts.length - 1 - depth));
}

const SKIP = (src: string) => !/(^|\/)(node_modules|\.git)$/.test(src);

function inside(root: string, p: string): boolean {
  const r = relative(root, p);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
}

export function runMutants(projectDir: string, mutants: Mutant[]): void {
  const core = readFileSync(join(projectDir, "core.bend"), "utf8");
  const laws = readFileSync(join(projectDir, "LAWS.bend"), "utf8");
  const proof = readFileSync(join(projectDir, "PROOF.bend"), "utf8");
  const sites = importSites([["core.bend", core], ["LAWS.bend", laws], ["PROOF.bend", proof]]);
  const { paths, depth } = relativeImports([core, laws, proof]);
  // Two heads, because the two kinds of counterexample are written in two
  // namespaces. An `at` instance is the law's statement as written, so its file
  // imports the core under the alias LAWS.bend gives it. A hand-written
  // `counter` names the core `C` -- §6 of the README -- whatever the laws call
  // it, and its file imports it as `C`.
  const atHead = counterImports(laws, coreAlias(laws));
  const counterHead = counterImports(laws);

  // Two sections with one name would be kept together, and their text
  // concatenated, so the proof would break somewhere that names neither:
  // refused by name and line, before any check.
  const doubles = duplicateSections(proof);
  if (doubles.length > 0) {
    for (const d of doubles) {
      console.log(`FAIL: PROOF.bend: duplicate section header ${JSON.stringify(d.header)} (lines ${d.lines.join(", ")}); give each section its own name`);
    }
    process.exit(1);
  }

  // Everything the scratch tree needs has to be there before the first check:
  // a missing import would otherwise read as a false counterexample.
  const gone = missingImports(projectDir, sites);
  if (gone.length > 0) {
    for (const g of gone) console.log(`FAIL: ${g.file}: import ${g.rel} does not exist: ${g.abs}`);
    process.exit(1);
  }

  function bend(dir: string, file: string, checkOnly: boolean): { ok: boolean; location: string } {
    const r = Bun.spawnSync(["bend", file, ...(checkOnly ? ["--check-only"] : [])], { cwd: dir, timeout: LIMIT_MS });
    if (r.exitedDueToTimeout) throw new Error(`${file}: the checker ran past ${LIMIT_MS / 1000} s: a problem to fix, not a limit to raise`);
    const out = r.stdout.toString() + r.stderr.toString();
    return { ok: out.includes("All terms check."), location: out.match(/^Location: (\S+)/m)?.[1] ?? "?" };
  }

  // Build the scratch tree for one run, call `f` in the project's copy, and
  // remove the tree whatever happens.
  function inScratch<T>(coreText: string, f: (dir: string) => T, lawsText = laws, proofText = proof): T {
    const root = mkdtempSync(join(tmpdir(), "bend-mutant-"));
    try {
      const dir = placeProject(root, projectDir, depth);
      mkdirSync(dirname(dir), { recursive: true });
      cpSync(resolve(projectDir), dir, { recursive: true, filter: SKIP });
      for (const rel of paths) {
        const from = resolve(projectDir, rel);
        const to = resolve(dir, rel);
        if (!inside(root, to)) throw new Error(`import ${rel}: would land outside the scratch tree`);
        mkdirSync(dirname(to), { recursive: true });
        if (existsSync(to)) continue; // already copied: it sits inside the project
        cpSync(from, to, { recursive: true, filter: SKIP });
      }
      writeFileSync(join(dir, "core.bend"), coreText);
      writeFileSync(join(dir, "LAWS.bend"), lawsText);
      writeFileSync(join(dir, "PROOF.bend"), proofText);
      return f(dir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // Does this equation close against this core? The checker runs the code, so
  // it holds exactly when both sides reduce to the same term. `head` is the
  // file's imports: the two namespaces above differ in nothing else.
  function checkClaim(coreText: string, claim: string, head: string): { ok: boolean; location: string } {
    return inScratch(coreText, (dir) => {
      writeFileSync(join(dir, "INSTANCE.bend"), `${head}\n\ndef counter() -> ${claim}:\n  {==}\n`);
      return bend(dir, "INSTANCE.bend", true);
    });
  }

  function proofChecks(coreText: string, m: Mutant, withLaws: [string, string][]): { ok: boolean; location: string } {
    const { head, secs } = sections(proof);
    const wanted = [m.section, ...withLaws.map(([, sec]) => sec)].map((x) => `# ---- ${x} ----`);
    const kept = secs.filter(([h]) => h.includes("tools") || wanted.includes(h));
    if (!kept.some(([h]) => h === `# ---- ${m.section} ----`)) {
      throw new Error(`${m.law}: no section "${m.section}" in PROOF.bend`);
    }
    return inScratch(coreText, (dir) => bend(dir, "PROOF.bend", false),
      onlyLaws(laws, [m.law, ...withLaws.map(([law]) => law)]),
      head + kept.map(([h, b]) => h + b).join(""));
  }

  let bad = 0;
  // A section named in `with` is kept with the law whose section it is.
  const lawOf = (sec: string): [string, string] => {
    const owner = mutants.find((x) => x.section === sec);
    if (!owner) throw new Error(`no mutant has the section "${sec}", so its law is unknown`);
    return [owner.law, sec];
  };
  for (const m of mutants) {
    const name = m.law.padEnd(26);
    // A counter written by hand is not read from the law: every line about it
    // says so, or the gap goes unnoticed.
    const loose = m.counter !== undefined && m.at === undefined ? "  (counter not tied to the law)" : "";
    const fail = (msg: string): void => {
      console.log(`  ${name} FAIL  ${msg}${loose}`);
      bad += 1;
    };

    let claim: string;
    let premises: Instance["premises"] = [];
    let head = counterHead;
    if (m.at !== undefined) {
      head = atHead;
      try {
        const inst = lawInstance(readLaw(laws, m.law), m.at);
        claim = inst.claim;
        premises = inst.premises;
      } catch (e) {
        fail((e as Error).message);
        continue;
      }
    } else if (m.counter) {
      claim = m.counter;
    } else {
      fail(`no counterexample: give "at" with a value for each of the law's binders, or "counter" with a claim of your own`);
      continue;
    }

    let mutated: string;
    try {
      mutated = mutate(core, m.from, m.to, m.law, m.nth);
    } catch (e) {
      fail((e as Error).message);
      continue;
    }
    const withLaws = (m.with ?? []).map(lawOf);

    // Check 1, conditional for an instance: the law says nothing where its own
    // premise is false, so a mutant that makes the premise false on the core
    // leaves nothing for the claim to hold against. Checks 2 to 5 still run,
    // so the row stays a checked claim. A `counter` carries no premise.
    const falseOnCore = premises.find((p) => !checkClaim(core, p.equation, head).ok);
    if (falseOnCore === undefined && !checkClaim(core, claim, head).ok) {
      fail(`the counterexample is false on the core itself: ${claim}`);
      continue;
    }
    const falsePremise = premises.find((p) => !checkClaim(mutated, p.equation, head).ok);
    if (falsePremise) {
      fail(`the law's premise "${falsePremise.binder}" is false on the mutant, so this instance is not a counterexample: ${falsePremise.equation}`);
      continue;
    }
    if (checkClaim(mutated, claim, head).ok) {
      fail(`the counterexample still holds on the mutant, so the law is not shown false: ${claim}`);
      continue;
    }
    const control = proofChecks(core, m, withLaws);
    if (!control.ok) {
      fail(`the proof does not check even unmutated (${control.location})`);
      continue;
    }
    const mutant = proofChecks(mutated, m, withLaws);
    if (mutant.ok) {
      fail(`still checks when ${m.why}`);
      continue;
    }
    if (mutant.location !== m.failsIn) {
      fail(`failed in ${mutant.location}, not ${m.failsIn}, when ${m.why}`);
      continue;
    }
    console.log(`  ${name} PASS  false when ${m.why}; fails in ${m.failsIn}${loose}${falseOnCore ? "  (premise false on the core)" : ""}`);
  }
  if (bad > 0) {
    console.log(`FAIL: ${bad} of ${mutants.length} mutants did not break the proof they target`);
    process.exit(1);
  }
  console.log(`PASS: all ${mutants.length} mutants are false laws, and break the proof they target`);
}
