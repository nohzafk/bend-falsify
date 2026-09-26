// Every law's proof has to fail when the law is made false -- and the law has
// to be false, shown by a counterexample, not asserted.
//
// For each mutant: copy the project's core, laws and proof into a scratch
// tree, keep only the tools and one law's section of PROOF.bend, and check:
//
//   1. the counterexample holds on the core as it is      (the claim is true)
//   2. the counterexample fails on the mutated core       (the law is false)
//   3. the proof checks on the core as it is              (the control)
//   4. the proof fails on the mutated core, in `failsIn`  (it depends on it)
//
// Steps 1 and 2 make `why` a checked claim: a proof that fails on a mutant
// where the law still holds would otherwise count as a kill. A proof that
// still checks against a false law would be saying nothing about the core.
//
// Isolating one section per law matters: the checker stops at the first
// failing def, and proofs over the same definitions break together, so a mutant
// run against the whole file would be blamed on whichever proof comes first.
//
// The scratch tree mirrors the project's place in the filesystem as deep as
// its relative imports climb: a project that imports ../../bend-schema/x is
// placed two directories below the scratch root, under its real ancestors'
// names, so every import resolves inside the scratch tree. Nothing outside
// the project and the directories it imports is copied, and nothing lands
// outside the scratch root.
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
  // An instance of the law at literals, as a Bend equation over the core
  // imported `as C`, and whatever else LAWS.bend imports, by its alias -- e.g. "{C.charge(C.plan1, 3n) == 30n : Nat}". It must
  // hold on the core and fail on the mutant: that is what makes `why` true.
  counter: string;
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

// The directories a project imports by a relative path that leaves it
// ("../base-facts", "../../bend-schema"), and how many levels the deepest
// one climbs. The project directory itself is copied whole, so an import
// inside it ("./x", "./dir/x") resolves too.
export function relativeImports(texts: string[]): { dirs: string[]; depth: number } {
  const dirs = [...new Set(texts.flatMap((text) =>
    [...text.matchAll(/^import ((?:\.\.\/)+)([^/\s]+)\//gm)].map((m) => `${m[1]}${m[2]}`)))];
  const depth = Math.max(1, ...dirs.map((d) => d.split("/").filter((s) => s === "..").length));
  return { dirs, depth };
}

// The counterexample file's imports: the core as C, and every other import
// LAWS.bend has, so a claim can name what a law's statement names (another
// package's error type, say). LAWS.bend's own import of the core is left out:
// one file under two names is a checker error.
export function counterImports(laws: string): string {
  const others = [...laws.matchAll(/^import (\S+)(?: as (\S+))?[ \t]*$/gm)]
    .filter(([, path]) => path !== "Base" && path !== "./core.bend")
    .map(([line]) => line);
  return ["import Base", "import ./core.bend as C", ...others].join("\n");
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
  const { dirs: imports, depth } = relativeImports([core, laws, proof]);
  const counterHead = counterImports(laws);

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
      for (const rel of imports) {
        const from = resolve(projectDir, rel);
        const to = resolve(dir, rel);
        if (!inside(root, to)) throw new Error(`import ${rel}: would land outside the scratch tree`);
        if (!existsSync(from)) throw new Error(`import ${rel}: ${from} does not exist`);
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

  function counterHolds(coreText: string, m: Mutant): { ok: boolean; out: string } {
    return inScratch(coreText, (dir) => {
      writeFileSync(join(dir, "COUNTER.bend"), `${counterHead}\n\ndef counter() -> ${m.counter}:\n  {==}\n`);
      const r = bend(dir, "COUNTER.bend", true);
      return { ok: r.ok, out: r.location };
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
    if (!m.counter) {
      console.log(`  ${name} FAIL  no counterexample: say at which literals the law is false after the mutation`);
      bad += 1;
      continue;
    }
    let mutated: string;
    try {
      mutated = mutate(core, m.from, m.to, m.law, m.nth);
    } catch (e) {
      console.log(`  ${name} FAIL  ${(e as Error).message}`);
      bad += 1;
      continue;
    }
    const withLaws = (m.with ?? []).map(lawOf);
    const cControl = counterHolds(core, m);
    const cMutant = cControl.ok ? counterHolds(mutated, m) : { ok: true, out: "" };
    const control = proofChecks(core, m, withLaws);
    const mutant = control.ok ? proofChecks(mutated, m, withLaws) : { ok: true, location: "" };
    if (!cControl.ok) {
      console.log(`  ${name} FAIL  the counterexample is false on the core itself: ${m.counter}`);
      bad += 1;
    } else if (cMutant.ok) {
      console.log(`  ${name} FAIL  the counterexample still holds on the mutant, so the law is not shown false: ${m.counter}`);
      bad += 1;
    } else if (!control.ok) {
      console.log(`  ${name} FAIL  the proof does not check even unmutated (${control.location})`);
      bad += 1;
    } else if (mutant.ok) {
      console.log(`  ${name} FAIL  still checks when ${m.why}`);
      bad += 1;
    } else if (mutant.location !== m.failsIn) {
      console.log(`  ${name} FAIL  failed in ${mutant.location}, not ${m.failsIn}, when ${m.why}`);
      bad += 1;
    } else {
      console.log(`  ${name} PASS  false when ${m.why}; fails in ${m.failsIn}`);
    }
  }
  if (bad > 0) {
    console.log(`FAIL: ${bad} of ${mutants.length} mutants did not break the proof they target`);
    process.exit(1);
  }
  console.log(`PASS: all ${mutants.length} mutants are false laws, and break the proof they target`);
}
