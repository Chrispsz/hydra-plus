import { logger } from "@main/services";
import {
  getCloudSaveRemoteStore,
  getPreferredCloudProvider,
  isGoogleDriveCloudLinked,
} from "@main/services/cloud-save/remote-store";
import { getDriveAccountEmail } from "@main/services/cloud-save/remote-store/google-drive/drive-client";
import {
  isGoogleClientIdConfiguredAtBuildTime,
  resolveGoogleClientId,
} from "@main/services/cloud-save/remote-store/google-drive/config";
import { isGoogleDriveTokenPlaintextFallback } from "@main/services/cloud-save/remote-store/google-drive/drive-token-store";
import { registerEvent } from "../register-event";

const getGoogleDriveStatus = async () => {
  const providerSelected =
    (await getPreferredCloudProvider()) === "google-drive";
  const linked = await isGoogleDriveCloudLinked();

  let email: string | null = null;
  let provider: Awaited<
    ReturnType<typeof getCloudSaveRemoteStore>
  >["provider"] = "hydra";

  if (linked) {
    // Ensures the token is usable AND gives the UI a human identifier.
    try {
      const store = await getCloudSaveRemoteStore();
      provider = store.provider;
      email = await getDriveAccountEmail();
    } catch (error) {
      logger.warn("Google Drive status check failed", error);
    }
  }

  const clientIdConfigured =
    isGoogleClientIdConfiguredAtBuildTime() ||
    Boolean(await resolveGoogleClientId());

  return {
    provider,
    providerSelected,
    linked,
    email,
    clientIdConfigured,
    requiresClientSetup: !clientIdConfigured,
    plaintextTokenFallback: await isGoogleDriveTokenPlaintextFallback(),
  };
};

registerEvent("getGoogleDriveStatus", getGoogleDriveStatus);
