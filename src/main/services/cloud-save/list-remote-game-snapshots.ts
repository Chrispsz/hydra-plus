import type { GameShop, RemoteSnapshotSummary } from "@types";

import { getCloudSaveRemoteStore } from "./remote-store";

export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> => {
  // Hydra Plus: the manifest file inside the user's Google Drive IS the
  // (single) active snapshot.
  const store = await getCloudSaveRemoteStore();
  const snapshot = await store.listSnapshot({ objectId, shop });
  return snapshot ? [snapshot] : [];
};
