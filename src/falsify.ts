#!/usr/bin/env bun
// Falsify candidate laws on concrete inputs, with the Bend checker as the runner.
//
//   bunx bend-falsify <spec.ts|spec.json> [--each]
//   bunx bend-falsify mutants [dir]      run <dir>/mutants.json (default: .)
//
// <spec.ts> default-exports { imports, instances }:
//
//   export default {
//     imports: ["./core.bend as C"],                 // relative to the spec file
//     instances: [
//       { name: "covers_0", claim: "{C.covered(C.merge(C.Iv{0n, 2n} <> Nil{}), 1n) == C.covered(C.Iv{0n, 2n} <> Nil{}, 1n) : Bool}" },
//       ...
//     ],
//   };
//
// Each instance becomes `def <name>() -> <claim>: {==}` in one scratch file. The
// checker runs the code on the literals, so an instance closes exactly when the
// law holds there. The checker stops at the first failing def: without --each
// you get one counterexample, fast; with --each every instance is checked
// alone (in parallel) and every counterexample is listed.
//
// A falsifier that has never failed proves nothing: plant a bug in a copy of
// the core, point `imports` at it, and require a counterexample.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type Mutant, runMutants, runMutantsAsync } from "./mutants.ts";

interface Spec {
  imports: string[];
  instances: { name: string; claim: string }[];
}

const USAGE = "usage: bend-falsify <spec.ts|spec.json> [--each]\n       bend-falsify mutants [dir] [--jobs N]   (reads <dir>/mutants.json)";
const [specPath, flag] = process.argv.slice(2);
if (!specPath) {
  console.error(USAGE);
  process.exit(2);
}
// The mutant table as data: a project with no TypeScript of its own keeps
// mutants.json beside core.bend, and needs Bun but no package.json.
if (specPath === "mutants") {
  const args = process.argv.slice(3);
  let project = args[0] ?? ".";
  let jobs: number | undefined;
  // Without --jobs, the arguments read exactly as before: the first is the
  // directory, and anything after it is ignored. --jobs opts into strict parsing.
  if (args.includes("--jobs")) {
    project = ".";
    let hasProject = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--jobs" && jobs === undefined) {
        const value = args[++i];
        jobs = value !== undefined && /^\d+$/.test(value) ? Number(value) : NaN;
        if (!Number.isInteger(jobs) || jobs < 1) {
          console.error("--jobs must be a positive integer"); process.exit(2);
        }
      } else if (!args[i].startsWith("-") && !hasProject) {
        project = args[i]; hasProject = true;
      } else { console.error(USAGE); process.exit(2); }
    }
  }
  const dir = resolve(project);
  const table: Mutant[] = (await import(join(dir, "mutants.json"))).default;
  if (!Array.isArray(table)) { console.error(`${join(dir, "mutants.json")}: expected an array of mutants`); process.exit(2); }
  if (jobs === undefined) {
    runMutants(dir, table);
  } else {
    const controller = new AbortController();
    let signalExit: number | undefined;
    const interrupt = () => { signalExit = 130; controller.abort(new Error("mutant run interrupted by SIGINT")); };
    const terminate = () => { signalExit = 143; controller.abort(new Error("mutant run interrupted by SIGTERM")); };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      await runMutantsAsync(dir, table, { jobs, signal: controller.signal });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = signalExit ?? 1;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  }
  process.exit(process.exitCode ?? 0);
}
// A .ts spec is run (it may compute its instances); a .json one is read.
const spec: Spec = (await import(resolve(specPath))).default;
const base = dirname(resolve(specPath));
// The scratch files live in a directory beside the spec, and a relative import
// is written relative to that directory: "./core.bend as C" ->
// "import ../core.bend as C". bend refuses an import path with a name that is
// not plain (letters, digits, _ and -), counted from the importing file, and
// ".." is allowed. An absolute path, or one from the system temp directory,
// carries every name above the project, so a checkout under a directory such
// as .worktrees/ could not be checked.
const dir = mkdtempSync(join(base, "falsify-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const head = ["import Base", ...spec.imports.map((i) => {
  const [path, ...rest] = i.split(" ");
  return `import ${path.startsWith(".") ? relative(dir, resolve(base, path)) : path} ${rest.join(" ")}`;
})].join("\n");
const body = (xs: Spec["instances"]) => xs.map((x) => `def ${x.name}() -> ${x.claim}:\n  {==}`).join("\n\n");

function run(file: string, text: string): string {
  writeFileSync(join(dir, file), text);
  // 5 s: a check that runs longer is a problem to fix (a large constant, a
  // fuel loop, application code in a goal), not a limit to raise.
  const r = Bun.spawnSync(["bend", join(dir, file), "--check-only"], { stdout: "pipe", stderr: "pipe", timeout: 5000 });
  if (r.exitedDueToTimeout) { console.log(`TIMEOUT: the checker ran past 5 s: a problem to fix, not a limit to raise`); process.exit(1); }
  return r.stdout.toString() + r.stderr.toString();
}
const clean = (out: string) => /^ALL PROOFS CHECK$/m.test(out);

function report(out: string): string {
  const pick = (k: string) => out.match(new RegExp(`^- ${k}\\s*: (.*)$`, "m"))?.[1] ?? "?";
  return `expected ${pick("expected")} / observed ${pick("observed")}`;
}

try {
  const t0 = performance.now();
  if (flag !== "--each") {
    const out = run("all.bend", `${head}\n\n${body(spec.instances)}\n`);
    const ms = Math.round(performance.now() - t0);
    if (clean(out)) {
      console.log(`holds on all ${spec.instances.length} instances (${ms} ms)`);
    } else {
      const loc = out.match(/^Location: (\S+)/m)?.[1];
      if (!loc) { console.log(out); process.exit(1); }
      const inst = spec.instances.find((x) => x.name === loc);
      console.log(`COUNTEREXAMPLE ${loc}: ${report(out)}`);
      if (inst) console.log(`  claim: ${inst.claim}`);
      process.exitCode = 1;
    }
  } else {
    const bad: string[] = [];
    let next = 0;
    let done = 0;
    const step = Math.max(1, Math.floor(spec.instances.length / 10));
    // Each instance is a checker run of ~0.15 s, so --each on thousands takes minutes.
    console.error(`checking ${spec.instances.length} instances one by one...`);
    // A few checkers at a time: one per instance at once would swamp the machine.
    const worker = async () => {
      for (let i = next++; i < spec.instances.length; i = next++) {
        const x = spec.instances[i];
        const file = join(dir, `i${i}.bend`);
        writeFileSync(file, `${head}\n\n${body([x])}\n`);
        const p = Bun.spawn(["bend", file, "--check-only"], { stdout: "pipe", stderr: "pipe", timeout: 5000 });
        const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
        await p.exited;
        if (p.signalCode) bad.push(`${x.name}: TIMEOUT, the checker ran past 5 s: a problem to fix, not a limit to raise\n  claim: ${x.claim}`);
        else if (!clean(out)) bad.push(`${x.name}: ${report(out)}\n  claim: ${x.claim}`);
        done++;
        if (done % step === 0) console.error(`  ${done}/${spec.instances.length} checked, ${bad.length} failing`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, navigator.hardwareConcurrency || 4) }, worker));
    const ms = Math.round(performance.now() - t0);
    if (bad.length === 0) console.log(`holds on all ${spec.instances.length} instances, each alone (${ms} ms)`);
    else { console.log(`${bad.length} of ${spec.instances.length} instances fail:\n${bad.sort().join("\n")}`); process.exitCode = 1; }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
