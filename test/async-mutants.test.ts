import { expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mutant } from "../src/index.ts";

const runner = join(import.meta.dir, "fixture_async.ts");
const cli = join(import.meta.dir, "../src/falsify.ts");
const project = join(import.meta.dir, "tree/group/proj");
const table: Mutant[] = JSON.parse(readFileSync(join(project, "mutants.json"), "utf8"));
const realEnv = { ...process.env, PATH: `${process.env.HOME}/.bend/bin:${process.env.PATH}`, BEND_NO_TELEMETRY: "1" };

function invoke(command: string[], env = realEnv) {
  const r = Bun.spawnSync([process.execPath, ...command], { env, timeout: 60000 });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

// These are actual Bend processes, not substituted oracle results. Include
// later-table dependency ownership, premise short circuits and both namespaces.
test("real Bend: jobs 1/2/4 preserve exact serial stdout and classifications", () => {
  const scratch = mkdtempSync(join(tmpdir(), "mutant-parity-"));
  try {
    const cases: Mutant[] = [
      ...table,
      { ...table[0], counter: "{C.double(1n) == 3n : Nat}", at: undefined },
      { ...table[0], at: { n: "0n" } },
      { ...table[0], failsIn: "Laws.keep_same" },
      { ...table[0], at: undefined },
      { ...table[1], nth: undefined },
      { ...table[0], at: {} },
      { ...table[0], at: { n: "1n", extra: "0n" } },
      { ...table[3], nth: 1 },
      { ...table[0], from: "no such line" },
      { ...table[0], nth: 20 },
      { ...table[0], law: "no_such_law" },
    ];
    const file = join(scratch, "cases.json");
    writeFileSync(file, JSON.stringify(cases));
    const baseline = invoke([runner, project, "sync", "1", file]);
    expect(baseline.code).toBe(1);
    expect(baseline.out).toContain("premise false on the core");
    expect(baseline.out).toContain("counter not tied to the law");
    expect(baseline.out).toContain("failed in Laws.double_adds, not Laws.keep_same");
    expect(baseline.out).toContain('premise "h" is false on the mutant');
    for (const jobs of [1, 2, 4]) {
      const r = invoke([runner, project, "async", String(jobs), file]);
      expect(r).toEqual(baseline);
    }
    for (const dir of ["tree/aliased", "tree/named", "../examples/plus0"]) {
      const path = join(import.meta.dir, dir);
      const serial = invoke([cli, "mutants", path]);
      expect(serial.code).toBe(0);
      for (const jobs of [1, 2, 4]) expect(invoke([cli, "mutants", path, "--jobs", String(jobs)])).toEqual(serial);
    }
    const example = join(import.meta.dir, "../examples/plus0");
    const reversed = JSON.parse(readFileSync(join(example, "mutants.json"), "utf8")).reverse();
    const reversedFile = join(scratch, "reversed.json");
    writeFileSync(reversedFile, JSON.stringify(reversed));
    const withLaterOwner = invoke([runner, example, "sync", "1", reversedFile]);
    expect(withLaterOwner.code).toBe(0);
    for (const jobs of [1, 2, 4]) expect(invoke([runner, example, "async", String(jobs), reversedFile])).toEqual(withLaterOwner);
    // A failure inside the shared tools section has the same warning and
    // semantics in both drivers; no new Bend fixture or proof is needed.
    cpSync(join(import.meta.dir, "tree"), join(scratch, "tree"), { recursive: true });
    const copied = join(scratch, "tree/group/proj");
    const proofPath = join(copied, "PROOF.bend");
    const proof = readFileSync(proofPath, "utf8");
    const shared = proof.replace("# ---- double adds ----", "# ---- tools: double adds ----");
    writeFileSync(proofPath, shared);
    const sharedTable = [{ ...table[0], section: "tools: double adds" }];
    writeFileSync(join(copied, "mutants.json"), JSON.stringify(sharedTable));
    const serial = invoke([cli, "mutants", copied]);
    expect(serial.code).toBe(0);
    expect(serial.out).toContain("fails in a shared lemma");
    for (const jobs of [1, 2, 4]) expect(invoke([cli, "mutants", copied, "--jobs", String(jobs)])).toEqual(serial);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 120000);

interface Event { event: string; pid: number; cwd: string; file: string; mutated: boolean; time: number }

function fakeFixture() {
  const root = mkdtempSync(join(tmpdir(), "mutant-async-test-"));
  const bin = join(root, "bin");
  const temp = join(root, "scratch");
  const log = join(root, "checks.jsonl");
  mkdirSync(bin); mkdirSync(temp); writeFileSync(log, "");
  // Copy the existing fixture (and its outward imports), rather than writing
  // new Bend. The fake is a controllable child process, never a mocked spawn.
  cpSync(join(import.meta.dir, "tree"), join(root, "tree"), { recursive: true });
  const dir = join(root, "tree/group/proj");
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...table[0], why: `row ${i}`, at: { n: `${i + 1}n` } }));
  writeFileSync(join(dir, "mutants.json"), JSON.stringify(rows));
  const executable = join(bin, "bend");
  writeFileSync(executable, `#!${process.execPath}
import { appendFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
const file = process.argv[2];
const core = readFileSync("core.bend", "utf8");
const mutated = core.includes("Nat.mul(n, 3n)");
const event = (event) => appendFileSync(process.env.CHECK_LOG, JSON.stringify({event, pid: process.pid, cwd: process.cwd(), file, mutated, time: Date.now()}) + "\\n");
event("start");
const source = readFileSync(file, "utf8");
if (process.env.CHECK_MODE === "hang" || (["hang-others", "spawn-later"].includes(process.env.CHECK_MODE) && !source.includes("double(1n)"))) await new Promise(() => {});
else {
  await Bun.sleep(source.includes("double(1n)") ? 150 : 35);
  if (!existsSync(process.cwd())) throw new Error("scratch deleted before exit");
  if (process.env.CHECK_MODE === "signal") process.kill(process.pid, "SIGKILL");
  else if (process.env.CHECK_MODE === "no-banner") console.log("no checker verdict");
  else if (process.env.CHECK_MODE === "control-fail" && file === "PROOF.bend" && !mutated) console.log("SOME PROOFS FAIL\\nLocation: control");
  else if (process.env.CHECK_MODE === "proof-survives" && file === "PROOF.bend" && mutated) console.log("ALL PROOFS CHECK");
  else if (!mutated) console.log("ALL PROOFS CHECK");
  else console.log("SOME PROOFS FAIL\\nLocation: Laws.double_adds");
  if (process.env.CHECK_MODE === "spawn-later") unlinkSync(process.argv[1]);
  event("end");
}
`);
  chmodSync(executable, 0o755);
  const env = { ...realEnv, PATH: bin, TMPDIR: temp, CHECK_LOG: log, CHECK_MODE: "normal" };
  const events = (): Event[] => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((s) => JSON.parse(s));
  const reset = () => writeFileSync(log, "");
  const clean = () => {
    expect(readdirSync(temp)).toEqual([]);
    for (const e of events()) {
      expect(existsSync(e.cwd)).toBe(false);
      let alive = true;
      try { process.kill(e.pid, 0); } catch { alive = false; }
      expect(alive).toBe(false);
    }
  };
  return { root, dir, bin, temp, log, env, rows, events, reset, clean,
    remove: () => rmSync(root, { recursive: true, force: true }) };
}

test("real children overlap, respect the row bound, preserve check order, and use isolated scratch", () => {
  const f = fakeFixture();
  try {
    const serial = invoke([runner, f.dir, "sync", "1"], f.env);
    expect(serial.code).toBe(0);
    expect(f.events().filter((e) => e.event === "start").map((e) => [e.file, e.mutated]))
      .toEqual(Array.from({ length: 8 }, () => [["INSTANCE.bend", false], ["INSTANCE.bend", true], ["PROOF.bend", false], ["PROOF.bend", true]]).flat());
    f.clean();
    for (const jobs of [1, 2, 4]) {
      f.reset();
      expect(invoke([runner, f.dir, "async", String(jobs)], f.env)).toEqual(serial);
      let active = 0; let maximum = 0;
      for (const event of f.events()) {
        active += event.event === "start" ? 1 : -1;
        maximum = Math.max(maximum, active);
        expect(active).toBeLessThanOrEqual(jobs);
      }
      expect(active).toBe(0);
      expect(maximum).toBe(jobs);
      const starts = f.events().filter((e) => e.event === "start");
      expect(starts).toHaveLength(8 * 4);
      expect(new Set(starts.map((e) => e.cwd)).size).toBe(starts.length);
      // Each row has two claims followed by the original and mutant proof.
      expect(starts.filter((e) => e.file === "INSTANCE.bend").length).toBe(16);
      expect(starts.filter((e) => e.file === "PROOF.bend" && !e.mutated).length).toBe(8);
      expect(starts.filter((e) => e.file === "PROOF.bend" && e.mutated).length).toBe(8);
      f.clean();
    }
    f.reset();
    expect(invoke([cli, "mutants", "--jobs", "2", f.dir], f.env)).toEqual(serial);
    f.clean();
    f.reset();
    expect(invoke([runner, f.dir, "async", "default"], f.env)).toEqual(serial);
    f.clean();
  } finally { f.remove(); }
}, 60000);

test("invalid jobs and pre-cancelled signals spawn nothing", () => {
  const f = fakeFixture();
  try {
    for (const jobs of ["0", "-1", "1.5", "NaN", "Infinity"]) {
      const r = invoke([runner, "/does/not/exist", "async", jobs, join(f.dir, "mutants.json")], f.env);
      expect(r.code).toBe(1); expect(r.err).toContain("jobs must be a positive integer");
      const cliResult = invoke([cli, "mutants", "/does/not/exist", "--jobs", jobs], f.env);
      expect(cliResult.code).toBe(2); expect(cliResult.err).toContain("--jobs must be a positive integer");
    }
    expect(invoke([runner, f.dir, "preabort", "2"], f.env).err).toContain("fixture pre-cancelled");
    expect(f.events()).toEqual([]); f.clean();
  } finally { f.remove(); }
});

test("preflight failures stay deterministic and spawn nothing", () => {
  const f = fakeFixture();
  try {
    rmSync(join(f.root, "tree/group/shared.bend"));
    const serial = invoke([cli, "mutants", f.dir], f.env);
    expect(serial.code).toBe(1); expect(serial.out).toContain("import ../shared.bend does not exist");
    for (const jobs of [1, 2, 4]) expect(invoke([cli, "mutants", f.dir, "--jobs", String(jobs)], f.env)).toEqual(serial);
    expect(f.events()).toEqual([]); f.clean();
    cpSync(join(import.meta.dir, "tree/group/shared.bend"), join(f.root, "tree/group/shared.bend"));
    const proofPath = join(f.dir, "PROOF.bend");
    writeFileSync(proofPath, readFileSync(proofPath, "utf8").replace("# ---- keep is the identity ----", "# ---- double adds ----"));
    const duplicate = invoke([cli, "mutants", f.dir], f.env);
    expect(duplicate.code).toBe(1); expect(duplicate.out).toContain("duplicate section header");
    for (const jobs of [1, 2, 4]) expect(invoke([cli, "mutants", f.dir, "--jobs", String(jobs)], f.env)).toEqual(duplicate);
    expect(f.events()).toEqual([]); f.clean();
  } finally { f.remove(); }
});

test("checker banner is required even with exit zero; all semantic failures complete", () => {
  const f = fakeFixture();
  try {
    const env = { ...f.env, CHECK_MODE: "no-banner" };
    const serial = invoke([cli, "mutants", f.dir], env);
    expect(serial.code).toBe(1); expect(serial.out).toContain("FAIL: 8 of 8");
    for (const jobs of [1, 2, 4]) {
      f.reset(); expect(invoke([cli, "mutants", f.dir, "--jobs", String(jobs)], env)).toEqual(serial);
      expect(f.events().filter((e) => e.event === "start")).toHaveLength(8); f.clean();
    }
  } finally { f.remove(); }
}, 30000);

test("proof control and surviving proof classifications match the serial driver", () => {
  const f = fakeFixture();
  try {
    for (const [mode, message] of [["control-fail", "the proof does not check even unmutated (control)"], ["proof-survives", "still checks when row"]]) {
      const env = { ...f.env, CHECK_MODE: mode };
      const serial = invoke([cli, "mutants", f.dir], env);
      expect(serial.code).toBe(1); expect(serial.out).toContain(message);
      for (const jobs of [1, 2, 4]) {
        f.reset(); expect(invoke([cli, "mutants", f.dir, "--jobs", String(jobs)], env)).toEqual(serial); f.clean();
      }
    }
  } finally { f.remove(); }
}, 30000);

test("spawn errors, checker signals, and API cancellation leave no children or scratch", () => {
  const f = fakeFixture();
  try {
    for (const mode of ["sync", "async"]) {
      const absent = invoke([runner, f.dir, mode, "4"], { ...f.env, PATH: "/does/not/exist" });
      expect(absent.code).toBe(1); expect(absent.out).not.toContain("PASS:");
      if (mode === "async") expect(absent.err).toContain("cleanup complete before rejection");
      f.clean();
    }
    const signalled = invoke([runner, f.dir, "async", "4"], { ...f.env, CHECK_MODE: "signal" });
    expect(signalled.code).toBe(1); expect(signalled.err).toContain("checker stopped by SIGKILL");
    expect(signalled.err).toContain("cleanup complete before rejection"); f.clean();
    f.reset();
    const cancelled = invoke([runner, f.dir, "abort", "2"], { ...f.env, CHECK_MODE: "hang" });
    expect(cancelled.code).toBe(1); expect(cancelled.err).toContain("fixture cancelled");
    expect(cancelled.err).toContain("cleanup complete before rejection");
    expect(f.events().filter((e) => e.event === "start")).toHaveLength(2); f.clean();
  } finally { f.remove(); }
}, 20000);

test("row errors and later spawn errors cancel children already running before rejection", () => {
  const f = fakeFixture();
  try {
    const broken = f.rows.map((row, i) => i === 0 ? { ...row, section: "missing proof section" } : row);
    writeFileSync(join(f.dir, "mutants.json"), JSON.stringify(broken));
    const rowError = invoke([runner, f.dir, "async", "4"], { ...f.env, CHECK_MODE: "hang-others" });
    expect(rowError.code).toBe(1); expect(rowError.err).toContain('no section "missing proof section"');
    expect(rowError.err).toContain("cleanup complete before rejection");
    expect(f.events().filter((e) => e.event === "start")).toHaveLength(5); f.clean();
    f.reset();
    writeFileSync(join(f.dir, "mutants.json"), JSON.stringify(f.rows));
    const spawnError = invoke([runner, f.dir, "async", "4"], { ...f.env, CHECK_MODE: "spawn-later" });
    expect(spawnError.code).toBe(1); expect(spawnError.err).toContain("cleanup complete before rejection");
    expect(spawnError.out).not.toContain("PASS:");
    expect(f.events().filter((e) => e.event === "start")).toHaveLength(4); f.clean();
  } finally { f.remove(); }
}, 20000);

test("sync and async keep the 5 s timeout; async waits for every child's cleanup", () => {
  const f = fakeFixture();
  try {
    for (const mode of ["sync", "async"]) {
      f.reset();
      const before = performance.now();
      const r = invoke([runner, f.dir, mode, "4"], { ...f.env, CHECK_MODE: "hang" });
      expect(r.code).toBe(1); expect(r.err).toContain("the checker ran past 5 s");
      if (mode === "async") expect(r.err).toContain("cleanup complete before rejection");
      expect(performance.now() - before).toBeGreaterThanOrEqual(4900);
      expect(r.out).not.toContain("PASS:"); f.clean();
    }
  } finally { f.remove(); }
}, 20000);

async function waitForStarts(f: ReturnType<typeof fakeFixture>, count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (f.events().filter((e) => e.event === "start").length < count) {
    if (Date.now() >= deadline) throw new Error("children never started");
    await Bun.sleep(10);
  }
}

test("dedicated CLI subprocess handles SIGINT and SIGTERM before exiting", async () => {
  const f = fakeFixture();
  try {
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      f.reset();
      const p = Bun.spawn([process.execPath, cli, "mutants", f.dir, "--jobs", "2"], {
        env: { ...f.env, CHECK_MODE: "hang" }, stdout: "pipe", stderr: "pipe", timeout: 10000,
      });
      try {
        await waitForStarts(f, 2);
        p.kill(signal);
        const [out, err, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        expect(exit).toBe(code); expect(err).toContain(`interrupted by ${signal}`);
        expect(out).not.toContain("PASS:"); f.clean();
      } finally { p.kill("SIGKILL"); await p.exited; }
    }
  } finally { f.remove(); }
}, 30000);
