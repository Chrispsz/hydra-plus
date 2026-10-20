/**
 * Process-liveness probe and the SIGTERM-then-wait escalation used by
 * stale compatibility cleanup (F1 stability fix), extracted verbatim
 * from launch-game.ts so the kill-tree escalation can be chained
 * against real operating-system processes without Electron.
 */

const STALE_COMPAT_POLL_INTERVAL_MS = 250;

/** Signal-0 probe: checks whether a pid exists without signaling it. */
export const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export interface CompatProcessKillDeps {
  /** Signal-0 liveness probe, injectable for deterministic tests. */
  probe?: (pid: number) => boolean;
  /** Poll interval of the grace-period wait. */
  pollIntervalMs?: number;
}

export const waitForProcessesToExit = async (
  pids: number[],
  timeoutMs: number,
  {
    probe = isProcessAlive,
    pollIntervalMs = STALE_COMPAT_POLL_INTERVAL_MS,
  }: CompatProcessKillDeps = {}
) => {
  const deadline = Date.now() + timeoutMs;
  let remaining = pids.filter(probe);

  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    remaining = remaining.filter(probe);
  }

  return remaining;
};

/**
 * The escalation as it runs before a launch: SIGTERM every stale pid so
 * wineserver can flush the prefix, then wait out the grace period and
 * report whatever survived — the caller decides about SIGKILL.
 */
export const terminateStaleProcesses = async (
  pids: number[],
  graceMs: number,
  deps: CompatProcessKillDeps = {}
): Promise<number[]> => {
  // SIGTERM first so wineserver can flush the prefix; escalate to SIGKILL
  // only for whatever survives the grace period.
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone or not ours — the poll below re-checks.
    }
  }

  return waitForProcessesToExit(pids, graceMs, deps);
};
