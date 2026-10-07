import { UserNotLoggedInError } from "@shared";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { notificationEvent } from "./events/notification";
import { resyncAfterEventFailure, resyncAfterReconnect } from "./resync";
import {
  RealtimeWebSocketClient,
  type RealtimeEnvelope,
  type RealtimeToken,
} from "./websocket-client";
import type { Notification } from "./types";

const dispatchEvent = async (
  { event, payload }: RealtimeEnvelope,
  signal: AbortSignal
) => {
  switch (event) {
    case "notification":
      await notificationEvent(payload satisfies Notification, signal);
      break;
  }
};

const client = new RealtimeWebSocketClient({
  mintToken: (signal) =>
    HydraApi.post<RealtimeToken>("/auth/realtime", undefined, { signal }),
  onEvent: dispatchEvent,
  onReconnect: (signal) => {
    void resyncAfterReconnect(signal).catch((error) =>
      logger.error("Failed to resync after realtime reconnect", error)
    );
  },
  onEventFailure: (signal) => {
    void resyncAfterEventFailure(signal).catch((error) =>
      logger.error("Failed to resync after realtime event failure", error)
    );
  },
  shouldStop: (error) => {
    if (error instanceof UserNotLoggedInError) {
      logger.info("Realtime connect skipped: user is not logged in");
      return true;
    }
    return false;
  },
  log: logger,
});

// Name retained for callsite and external service compatibility.
export class SSEClient {
  static connect() {
    client.connect();
  }

  static close() {
    client.close();
  }

  static reconnectNow() {
    client.reconnectNow();
  }
}
