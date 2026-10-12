// The limits on one checker run, shared by the spec path and the mutant path.
//
// A check may use 5 s of CPU. The limit counts CPU time, not wall-clock time:
// a loaded machine (several gates at once) stretches every check's wall time
// without the Bend changing, and a wall-clock limit then fails checks at
// random. CPU time is the sum over the checker's threads, so on an idle
// machine a check reaches it in less than 5 s of wall time. A check past 5 s
// of CPU is a problem to fix (a large constant, a fuel loop, application code
// in a goal), not a limit to raise.
//
// A checker that waits instead of computing never reaches the CPU limit; a
// wall-clock limit of 60 s stops it. BEND_FALSIFY_WALL_MS lowers it for this
// repository's own tests of a hanging checker.

export const CPU_S = 5;
export const WALL_MS = Number(process.env.BEND_FALSIFY_WALL_MS ?? 60_000);

// `bend <args>` under the CPU limit. The shell execs bend, so the child is
// bend itself: a run past the limit ends with SIGXCPU. When bend is not on
// PATH the shell exits with NOT_FOUND instead of the spawn failing.
export function bendCommand(args: string[]): string[] {
  return ["/bin/sh", "-c", `ulimit -t ${CPU_S} && exec bend "$@"`, "bend", ...args];
}
export const NOT_FOUND = 127;
export const NOT_FOUND_MESSAGE = "bend: not found on PATH";

export const CPU_SIGNAL = "SIGXCPU";
export const CPU_MESSAGE = `the checker used more than ${CPU_S} s of CPU: a problem to fix, not a limit to raise`;
export const WALL_MESSAGE = `the checker did not finish in ${WALL_MS / 1000} s of wall time: it waits instead of computing`;
