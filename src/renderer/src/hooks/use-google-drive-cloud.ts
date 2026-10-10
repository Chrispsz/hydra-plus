import { useCallback, useEffect, useState } from "react";
import type { GoogleDriveCloudStatus } from "@types";

export interface GoogleDriveCloud {
  status: GoogleDriveCloudStatus | null;
  /** True when the Drive account is linked (cloud saves usable). */
  isDriveCloudActive: boolean;
  /** True when Drive is not linked yet. */
  isDrivePendingLink: boolean;
  /** True when no OAuth client id is configured (user setup required). */
  requiresClientSetup: boolean;
  refresh: () => Promise<GoogleDriveCloudStatus | null>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * Tracks the Google Drive state (OAuth link status + client configuration).
 * Hydra Plus is Drive-only: cloud saves are usable whenever
 * `isDriveCloudActive` is true — no provider choice, no subscription.
 */
export function useGoogleDriveCloud(): GoogleDriveCloud {
  const [status, setStatus] = useState<GoogleDriveCloudStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await window.electron.getGoogleDriveStatus();
      setStatus(nextStatus);
      return nextStatus;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.electron.onUserPreferencesUpdated(() => {
      void refresh();
    });
    return unsubscribe;
  }, [refresh]);

  const connect = useCallback(async () => {
    await window.electron.startGoogleAuth();
    await refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await window.electron.disconnectGoogleDrive();
    await refresh();
  }, [refresh]);

  const isDriveCloudActive = !!status?.linked;
  const isDrivePendingLink = !status?.linked;

  return {
    status,
    isDriveCloudActive,
    isDrivePendingLink,
    requiresClientSetup: !!status?.requiresClientSetup,
    refresh,
    connect,
    disconnect,
  };
}
