import type { CloudSaveCustomPath, GameShop } from "@types";
import type { CloudSaveCustomPathContext } from "@main/services/cloud-save/custom-path";

/**
 * Registers the save-path matrix of a freshly imported custom game as
 * cloud-save custom paths, mirroring the manual selection flow
 * (select-cloud-save-custom-path → canonicalize → register, pending until
 * the first sync pushes them). Everything is injected so the flow is
 * unit-testable without Electron or LevelDB.
 */

export interface CustomGameSavePathDeps {
  /** Cloud-save context derived from the game's path context. */
  getCustomPathContext: (
    objectId: string,
    shop: GameShop
  ) => Promise<CloudSaveCustomPathContext>;
  /** Existence + kind probe; null when the path does not exist. */
  statPath: (absolutePath: string) => Promise<"file" | "dir" | null>;
  canonicalize: (
    selectedPath: string,
    context: CloudSaveCustomPathContext,
    kind: "file" | "dir"
  ) => Promise<CloudSaveCustomPath>;
  /** Existing custom-path-store registration (handles the user id key). */
  registerCloudSaveCustomPaths: (
    shop: GameShop,
    objectId: string,
    customPaths: CloudSaveCustomPath[],
    options?: { syncState?: "pending" | "confirmed" }
  ) => Promise<void>;
  warn: (message: string, ...meta: unknown[]) => void;
}

export const registerSavePathsForCustomGame = async (
  shop: GameShop,
  objectId: string,
  savePaths: Array<string | null | undefined> | null | undefined,
  deps: CustomGameSavePathDeps
): Promise<CloudSaveCustomPath[]> => {
  const paths = (savePaths ?? []).filter(
    (savePath): savePath is string =>
      typeof savePath === "string" && savePath.trim().length > 0
  );
  if (paths.length === 0) return [];

  const context = await deps.getCustomPathContext(objectId, shop);
  const customPaths: CloudSaveCustomPath[] = [];

  for (const savePath of paths) {
    const kind = await deps.statPath(savePath).catch(() => null);
    if (!kind) {
      deps.warn("[Cloud Save] Skipping non-existent custom game save path", {
        objectId,
        shop,
        savePath,
      });
      continue;
    }

    const customPath = await deps
      .canonicalize(savePath, context, kind)
      .catch((error: unknown) => {
        deps.warn("[Cloud Save] Failed to register custom game save path", {
          objectId,
          shop,
          savePath,
          error,
        });
        return null;
      });
    if (customPath) customPaths.push(customPath);
  }

  if (customPaths.length === 0) return [];

  await deps.registerCloudSaveCustomPaths(shop, objectId, customPaths, {
    syncState: "pending",
  });
  return customPaths;
};
