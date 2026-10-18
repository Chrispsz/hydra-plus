import type { ProtonInstallPhase, ProtonInstallProgress } from "@types";

/**
 * Leading-edge throttle for install progress events: phase changes and
 * terminal phases always go through immediately, byte updates within
 * the same phase are limited to one event per interval.
 */

const TERMINAL_PHASES: readonly ProtonInstallPhase[] = ["done", "error"];

export const createProgressThrottle = (options: {
  emit: (payload: ProtonInstallProgress) => void;
  minIntervalMs: number;
  now?: () => number;
}) => {
  const now = options.now ?? (() => Date.now());
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  let lastPhase: ProtonInstallPhase | null = null;

  return (payload: ProtonInstallProgress) => {
    const phaseChanged = payload.phase !== lastPhase;
    const isTerminal = TERMINAL_PHASES.includes(payload.phase);

    if (
      phaseChanged ||
      isTerminal ||
      now() - lastEmitAt >= options.minIntervalMs
    ) {
      lastEmitAt = now();
      lastPhase = payload.phase;
      options.emit(payload);
    }
  };
};
