import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mutant } from "../src/index.ts";

const runner = join(import.meta.dir, "fixture_async.ts");
const realEnv = { ...process.env, PATH: `${process.env.HOME}/.bend/bin:${process.env.PATH}`, BEND_NO_TELEMETRY: "1" };
const table: Mutant[] = JSON.parse(readFileSync(join(import.meta.dir, "tree/group/proj/mutants.json"), "utf8"));
interface Start { file: string; mutated: boolean; defs: number }

// A fake `bend` that reads no Bend: an instance def whose claim contains BAD is
// false on the core, every instance is false on the mutant, and a proof checks
// only on the core. Like bend, it stops at the first false def and names it.
// UNKNOWN_LOCATION makes a failing file with several defs name no def.
function fixture(claims: string[]) {
  const root = mkdtempSync(join(tmpdir(), "mutant-dedupe-test-"));
  const bin = join(root, "bin");
  const log = join(root, "checks.jsonl");
  mkdirSync(bin); writeFileSync(log, "");
  cpSync(join(import.meta.dir, "tree"), join(root, "tree"), { recursive: true });
  const dir = join(root, "tree/group/proj");
  const rows = claims.map((c, i) => ({ ...table[0], why: `row ${i}`, at: undefined, counter: c }));
  writeFileSync(join(dir, "mutants.json"), JSON.stringify(rows));
  const file = join(root, "rows.json");
  writeFileSync(file, JSON.stringify(rows));
  writeFileSync(join(bin, "bend"), `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const file = process.argv[2];
const mutated = readFileSync("core.bend", "utf8").includes("Nat.mul(n, 3n)");
const source = readFileSync(file, "utf8");
const defs = [...source.matchAll(/^def (\\S+)\\(\\) -> (.*):$/gm)];
appendFileSync(process.env.CHECK_LOG, JSON.stringify({ file, mutated, defs: defs.length }) + "\\n");
await Bun.sleep(60);
if (file === "PROOF.bend") console.log(mutated ? "SOME PROOFS FAIL\\nLocation: Laws.double_adds" : "ALL PROOFS CHECK");
else if (mutated) console.log("SOME PROOFS FAIL\\nLocation: counter");
else {
  const bad = defs.find((d) => d[2].includes("BAD"));
  if (!bad) console.log("ALL PROOFS CHECK");
  else console.log("SOME PROOFS FAIL\\nLocation: " + (process.env.UNKNOWN_LOCATION && defs.length > 1 ? "nowhere" : bad[1]));
}
`);
  chmodSync(join(bin, "bend"), 0o755);
  const env = { ...realEnv, PATH: bin, CHECK_LOG: log };
  const run = (mode: "sync" | "async", jobs = 4, extra: Record<string, string> = {}) => {
    writeFileSync(log, "");
    const r = Bun.spawnSync([process.execPath, runner, dir, mode, String(jobs), file], { env: { ...env, ...extra }, timeout: 60000 });
    const starts: Start[] = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return { code: r.exitCode, out: r.stdout.toString(), starts };
  };
  return { run, remove: () => rmSync(root, { recursive: true, force: true }) };
}
const claim = (n: number, bad = false) => `{C.double(${n}n) == Nat.mul(${n}n, 2n) : Nat}${bad ? " BAD" : ""}`.replace(" BAD", "").replace(": Nat}", bad ? ": Nat BAD}" : ": Nat}");
const count = (r: { starts: Start[] }, file: string, mutated: boolean) => r.starts.filter((s) => s.file === file && s.mutated === mutated).length;

test("rows with the same control share one proof spawn, concurrent or serial", () => {
  const f = fixture([1, 2, 3, 4].map((n) => claim(n)));
  try {
    for (const [mode, jobs] of [["sync", 1], ["async", 4]] as const) {
      const r = f.run(mode, jobs);
      expect(r.code).toBe(0);
      expect(count(r, "PROOF.bend", false)).toBe(1);
      expect(count(r, "PROOF.bend", true)).toBe(1);
    }
  } finally { f.remove(); }
});

test("a batch of equations that all hold is one spawn on the core", () => {
  const f = fixture([1, 2, 3, 4].map((n) => claim(n)));
  try {
    const r = f.run("async");
    expect(r.code).toBe(0);
    expect(r.starts.filter((s) => s.file === "INSTANCE.bend" && !s.mutated)).toEqual([{ file: "INSTANCE.bend", mutated: false, defs: 4 }]);
    expect(count(r, "INSTANCE.bend", true)).toBe(4);
  } finally { f.remove(); }
});

test("a false equation in a batch gives each equation the verdict of its own check", () => {
  const f = fixture([1, 2, 3, 4, 5].map((n) => claim(n, n === 3)));
  try {
    const serial = f.run("sync", 1);
    expect(serial.out).toContain("the counterexample is false on the core itself");
    for (const jobs of [1, 4]) {
      const r = f.run("async", jobs);
      expect(r.out).toBe(serial.out);
      expect(r.code).toBe(serial.code);
      // the batch of five stops at the third def; the other four are batched again
      expect(r.starts.filter((s) => s.file === "INSTANCE.bend" && !s.mutated).map((s) => s.defs)).toEqual([5, 4]);
    }
  } finally { f.remove(); }
});

test("a failure naming none of the batch's defs falls back to single checks", () => {
  const f = fixture([1, 2, 3].map((n) => claim(n, n === 2)));
  try {
    const serial = f.run("sync", 1);
    const r = f.run("async", 4, { UNKNOWN_LOCATION: "1" });
    expect(r.out).toBe(serial.out);
    expect(r.code).toBe(serial.code);
    expect(r.starts.filter((s) => s.file === "INSTANCE.bend" && !s.mutated).map((s) => s.defs).sort()).toEqual([1, 1, 1, 3]);
  } finally { f.remove(); }
});
