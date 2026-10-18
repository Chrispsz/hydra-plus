/**
 * Timer rearmed on every progress event: slow-but-alive transfers
 * survive, dead sockets do not. Mirrors the watchdog concept from the
 * Drive client, adapted to notify via callback instead of an owned
 * AbortSignal (the caller owns the single request controller).
 */

export interface InactivityWatchdog {
  reset: () => void;
  clear: () => void;
}

export const createInactivityWatchdog = (options: {
  timeoutMs: number;
  onTimeout: () => void;
}): InactivityWatchdog => {
  let timer: NodeJS.Timeout | null = null;

  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      options.onTimeout();
    }, options.timeoutMs);
  };

  arm();

  return {
    reset: arm,
    clear: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};
