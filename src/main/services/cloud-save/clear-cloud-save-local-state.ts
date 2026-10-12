import {
  cloudSaveCustomPathsSublevel,
  cloudSaveLocalHashCacheSublevel,
  cloudSaveSyncAnchorsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type { GameShop } from "@types";

import { isCloudSaveSyncAnchorKeyForGame } from "./sync-anchor-key";
import { getCurrentCloudSaveUserId } from "./cloud-save-user-id";

const getCurrentUserId = getCurrentCloudSaveUserId;

export const clearCloudSaveLocalState = async (
  objectId: string,
  shop: GameShop,
  customPathStorageKey: string
) => {
  const userId = await getCurrentUserId();
  const cacheKey = levelKeys.game(shop, objectId);
  const anchorKeys: string[] = [];
  for await (const [key] of cloudSaveSyncAnchorsSublevel.iterator()) {
    if (isCloudSaveSyncAnchorKeyForGame(key, userId, shop, objectId)) {
      anchorKeys.push(key);
    }
  }

  const batch = db.batch();
  batch.del(customPathStorageKey, {
    sublevel: cloudSaveCustomPathsSublevel,
  });
  batch.del(cacheKey, {
    sublevel: cloudSaveLocalHashCacheSublevel,
  });
  for (const anchorKey of anchorKeys) {
    batch.del(anchorKey, {
      sublevel: cloudSaveSyncAnchorsSublevel,
    });
  }
  await batch.write();
};
