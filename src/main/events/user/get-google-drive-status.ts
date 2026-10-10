import { logger } from "@main/services";
import { isGoogleDriveCloudLinked } from "@main/services/cloud-save/remote-store";
import { getDriveAccountEmail } from "@main/services/cloud-save/remote-store/google-drive/drive-client";
import {
  isGoogleClientIdConfiguredAtBuildTime,
  resolveGoogleClientId,
} from "@main/services/cloud-save/remote-store/google-drive/config";
import { isGoogleDriveTokenPlaintextFallback } from "@main/services/cloud-save/remote-store/google-drive/drive-token-store";
import { registerEvent } from "../register-event";

const getGoogleDriveStatus = async () => {
  const linked = await isGoogleDriveCloudLinked();

  let email: string | null = null;

  if (linked) {
    // Ensures the token is usable AND gives the UI a human identifier.
    try {
      email = await getDriveAccountEmail();
    } catch (error) {
      logger.warn("Google Drive status check failed", error);
    }
  }

  const clientIdConfigured =
    isGoogleClientIdConfiguredAtBuildTime() ||
    Boolean(await resolveGoogleClientId());

  return {
    provider: "google-drive" as const,
    providerSelected: linked,
    linked,
    email,
    clientIdConfigured,
    requiresClientSetup: !clientIdConfigured,
    plaintextTokenFallback: await isGoogleDriveTokenPlaintextFallback(),
  };
};

registerEvent("getGoogleDriveStatus", getGoogleDriveStatus);
