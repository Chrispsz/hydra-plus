import { logger } from "@main/services";
import { invalidateRemoteStoreCache } from "@main/services/cloud-save/remote-store/provider-resolver";
import { disconnectGoogleDriveAccount } from "@main/services/cloud-save/remote-store/google-drive/google-oauth";
import { registerEvent } from "../register-event";

const disconnectGoogleDrive = async () => {
  try {
    await disconnectGoogleDriveAccount();
    invalidateRemoteStoreCache();
    return { ok: true };
  } catch (error) {
    logger.error("Failed to disconnect Google Drive account", error);
    throw new Error("google_drive_disconnect_failed");
  }
};

registerEvent("disconnectGoogleDrive", disconnectGoogleDrive);
