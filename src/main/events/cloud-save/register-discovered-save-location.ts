import {
  assertCloudSaveDriveLinked,
  assertCloudSaveCustomPathDoesNotOverlap,
  assertCloudSaveCustomPathHasEligibleFiles,
  assertCloudSaveDeletionInactive,
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  getCloudSaveGameContext,
  isCloudSaveSyncActive,
  registerCloudSaveCustomPathWithoutOverlap,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import { assertCloudSaveCustomPathKindAllowed } from "@main/services/cloud-save/custom-path-selection-policy";
import type { GameShop, SelectCloudSaveCustomPathResult } from "@types";

import { registerEvent } from "../register-event";

/**
 * Tracks a save location found by the system-wide discovery scanner.
 * Same pipeline as selectCloudSaveCustomPath, but with a supplied path
 * instead of a native dialog.
 */
registerEvent(
  "registerDiscoveredSaveLocation",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    locationPath: string
  ): Promise<SelectCloudSaveCustomPathResult> => {
    await assertCloudSaveDriveLinked();
    if (!locationPath) {
      throw new Error("cloud_save_custom_path_missing");
    }
    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_custom_path_game_running");
    }
    if (isCloudSaveSyncActive(objectId, shop)) {
      throw new Error("cloud_save_custom_path_sync_active");
    }
    assertCloudSaveDeletionInactive(objectId, shop);

    const context = await getCloudSaveGameContext(objectId, shop);
    assertCloudSaveCustomPathKindAllowed("dir", shop, context.game?.platform);
    const customPathContext = cloudSaveCustomPathContextFromPathContext(
      context.pathContext
    );
    const customPath = await canonicalizeSelectedCloudSaveCustomPath(
      locationPath,
      customPathContext,
      "dir"
    );
    await assertCloudSaveCustomPathDoesNotOverlap({
      objectId,
      shop,
      selectedPath: customPath.path,
      context,
    });
    await assertCloudSaveCustomPathHasEligibleFiles(
      objectId,
      shop,
      context,
      customPath
    );
    await registerCloudSaveCustomPathWithoutOverlap({
      objectId,
      shop,
      customPath,
      context,
      syncState: "pending",
      assertCanRegister: () => {
        if (isGameRunning(objectId, shop)) {
          throw new Error("cloud_save_custom_path_game_running");
        }
        if (isCloudSaveSyncActive(objectId, shop)) {
          throw new Error("cloud_save_custom_path_sync_active");
        }
        assertCloudSaveDeletionInactive(objectId, shop);
      },
    });
    return { canceled: false, customPath };
  }
);
