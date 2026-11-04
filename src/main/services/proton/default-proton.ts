import type { UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { Umu } from "@main/services/umu";
import { WindowManager } from "@main/services/window-manager";

import { pickNewestCachyOsProton } from "./default-proton-selection.js";

/**
 * Electron-bound halves of the default-Proton policy (the pure naming
 * and selection helpers live in default-proton-selection.ts). This
 * module is never loaded by the node test runner.
 */

/**
 * Newest installed CachyOS build path — a read-only scan (manager
 * installs, distro packages and extra compat tool roots), never a
 * download. Used both by the launch fallback and by the read-only
 * "which Proton will this launch use" event.
 */
export const getNewestInstalledCachyOsProtonPath = async (): Promise<
  string | null
> => {
  if (process.platform !== "linux") return null;

  const versions = await Umu.getInstalledProtonVersions().catch(() => []);

  return pickNewestCachyOsProton(versions)?.path ?? null;
};

/**
 * Persists `defaultProtonPath` and pushes the update to the renderer,
 * mirroring the updateUserPreferences event. Only the proton field is
 * touched — none of the event's other side effects (language, prefix
 * pinning, download directories) apply here.
 */
export const setDefaultProtonPath = async (
  protonPath: string
): Promise<void> => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const updatedPreferences: UserPreferences = {
    ...userPreferences,
    defaultProtonPath: protonPath,
  };

  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    updatedPreferences,
    { valueEncoding: "json" }
  );

  WindowManager.sendToAppWindows(
    "on-user-preferences-updated",
    updatedPreferences
  );
};
