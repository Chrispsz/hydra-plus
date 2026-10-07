import { HydraApi } from "@main/services/hydra-api";
import type { GameShop, RemoteSnapshotSummary } from "@types";

import { validateRemoteSnapshotSummary } from "./cloud-save-contract";
import {
  getCloudSaveRemoteStore,
  isGoogleDriveCloudActive,
} from "./remote-store";

const validateRemoteSnapshots = (value: unknown): RemoteSnapshotSummary[] => {
  if (!Array.isArray(value)) throw new Error("Invalid snapshots response");
  if (value.length > 1) {
    throw new Error("Cloud Save API returned more than one active snapshot");
  }
  return value.map(validateRemoteSnapshotSummary);
};

export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> => {
  // Hydra Plus: when the user uses their own Google Drive, the manifest
  // file inside their Drive IS the (single) active snapshot.
  if (await isGoogleDriveCloudActive()) {
    const store = await getCloudSaveRemoteStore();
    const snapshot = await store.listSnapshot({ objectId, shop });
    return snapshot ? [snapshot] : [];
  }

  return validateRemoteSnapshots(
    await HydraApi.get<unknown>(
      "/profile/cloud-saves/snapshots",
      {
        shop,
        objectId,
      },
      {
        needsAuth: true,
        needsSubscription: true,
      }
    )
  );
};
