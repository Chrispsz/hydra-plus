import { useCallback, useEffect, useState } from "react";
import type { GoogleDriveCloudStatus } from "@types";
import { useAppSelector } from "./redux";

export interface GoogleDriveCloud {
  /** Global provider preference ("hydra" | "google-drive"). */
  provider: "hydra" | "google-drive";
  status: GoogleDriveCloudStatus | null;
  /** True when the user picked Google Drive AND the account is linked. */
  isDriveCloudActive: boolean;
  /** True when the user picked Google Drive but has not linked it yet. */
  isDrivePendingLink: boolean;
  /** True when no OAuth client id is configured (user setup required). */
  requiresClientSetup: boolean;
  refresh: () => Promise<GoogleDriveCloudStatus | null>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * Tracks the Google Drive cloud provider state: the global preference
 * (Settings → Cloud), the link status (OAuth refresh token) and the
 * OAuth client configuration. Cloud Saves are free whenever
 * `isDriveCloudActive` is true — no Hydra Cloud subscription involved.
 */
export function useGoogleDriveCloud(): GoogleDriveCloud {
  const provider =
    useAppSelector((state) => state.userPreferences.value?.cloudProvider) ??
    "hydra";

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
  }, [refresh, provider]);

  const connect = useCallback(async () => {
    await window.electron.startGoogleAuth();
    await refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await window.electron.disconnectGoogleDrive();
    await refresh();
  }, [refresh]);

  const isDriveCloudActive = provider === "google-drive" && !!status?.linked;
  const isDrivePendingLink = provider === "google-drive" && !status?.linked;

  return {
    provider,
    status,
    isDriveCloudActive,
    isDrivePendingLink,
    requiresClientSetup: !!status?.requiresClientSetup,
    refresh,
    connect,
    disconnect,
  };
}
