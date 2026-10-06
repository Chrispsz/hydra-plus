import { logger } from "@main/services";
import { invalidateRemoteStoreCache } from "@main/services/cloud-save/remote-store/provider-resolver";
import { startGoogleDriveAuth } from "@main/services/cloud-save/remote-store/google-drive/google-oauth";
import { registerEvent } from "../register-event";

const startGoogleAuth = async () => {
  try {
    const result = await startGoogleDriveAuth();
    invalidateRemoteStoreCache();
    return result;
  } catch (error) {
    logger.error("Failed to link Google Drive account", error);
    const message =
      error instanceof Error ? error.message : "google_auth_failed";
    throw new Error(message);
  }
};

registerEvent("startGoogleAuth", startGoogleAuth);
