import type { NotificationCountResponse } from "@types";
import { randomInt } from "node:crypto";
import { HydraApi } from "@main/services/hydra-api";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";
import { ResyncCoordinator } from "./resync-coordinator";

type ResyncScope = "notifications";

const ALL_SCOPES: ResyncScope[] = ["notifications"];
const RESYNC_JITTER_MS = 15_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();

    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const syncNotificationCount = async (signal: AbortSignal) => {
  const { count } = await HydraApi.get<NotificationCountResponse>(
    "/profile/notifications/count",
    undefined,
    { signal }
  );
  if (signal.aborted) return;
  WindowManager.sendToAppWindows("on-sync-notification-count", {
    notificationCount: count,
  });
};

const SCOPE_TASKS: Record<
  ResyncScope,
  {
    errorMessage: string;
    task: (signal: AbortSignal) => Promise<void>;
  }
> = {
  notifications: {
    errorMessage: "Failed to resync notification count:",
    task: syncNotificationCount,
  },
};

const runResync = async (
  scopes: ReadonlySet<ResyncScope>,
  signal: AbortSignal,
  jitter: boolean
) => {
  if (jitter) await sleep(randomInt(RESYNC_JITTER_MS + 1), signal);

  let firstError: unknown;
  for (const scope of ALL_SCOPES) {
    if (signal.aborted) return;
    if (!scopes.has(scope)) continue;

    const { errorMessage, task } = SCOPE_TASKS[scope];
    try {
      await task(signal);
    } catch (error) {
      if (signal.aborted) return;
      firstError ??= error;
      logger.error(errorMessage, error);
    }
  }

  if (firstError) throw firstError;
};

const coordinator = new ResyncCoordinator<ResyncScope>(runResync);

export const resyncAfterReconnect = (signal: AbortSignal) =>
  coordinator.request(ALL_SCOPES, signal, true);

export const resyncAfterEventFailure = (signal: AbortSignal) =>
  coordinator.request(ALL_SCOPES, signal);

export const resyncNotifications = (signal: AbortSignal) =>
  coordinator.request(["notifications"], signal);
