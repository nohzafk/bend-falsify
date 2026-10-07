// A subprocess keeps the public APIs' failure status out of the test runner.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { runMutants, runMutantsAsync, type Mutant } from "../src/index.ts";

const [dir, mode, jobsText, tableFile] = process.argv.slice(2);
const table: Mutant[] = JSON.parse(readFileSync(tableFile ?? `${dir}/mutants.json`, "utf8"));
if (mode === "sync") runMutants(dir, table);
else {
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  if (mode === "abort") {
    timer = setInterval(() => {
      const log = readFileSync(process.env.CHECK_LOG!, "utf8");
      if (log.trim().split("\n").length >= 2) controller.abort(new Error("fixture cancelled"));
    }, 10);
  } else if (mode === "preabort") controller.abort(new Error("fixture pre-cancelled"));
  try {
    await runMutantsAsync(dir, table, { jobs: jobsText === "default" ? undefined : Number(jobsText), signal: controller.signal });
  } catch (error) {
    // Verify at the rejection boundary, not only after this subprocess exits.
    // Otherwise runtime teardown could hide a runner that rejects too early.
    if (process.env.CHECK_LOG) {
      const events: { pid: number; cwd: string }[] = readFileSync(process.env.CHECK_LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const live = events.some(({ pid, cwd }) => {
        if (existsSync(cwd)) return true;
        try { process.kill(pid, 0); return true; } catch { return false; }
      });
      if (live || readdirSync(process.env.TMPDIR!).length > 0) throw new Error("cleanup incomplete at rejection");
      console.error("cleanup complete before rejection");
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (timer !== undefined) clearInterval(timer);
  }
}
