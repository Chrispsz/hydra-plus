import { logger } from "../logger";
import { getSteamLibraryFolders } from "../steam";

import { findSteamCompatibilityPrefixInLibraries } from "./steam-compat-prefix-core";
import { Wine } from "../wine";

/**
 * Locates the Wine prefix Steam Proton maintains for a game
 * (`<library>/steamapps/compatdata/<appId>/pfx`).
 *
 * Hydra Plus: users on Linux routinely launch their games through Steam
 * (Proton is the best-tuned compatibility layer, and Hydra's own umu
 * launch can fail environment-side). Those sessions write saves into
 * Steam's compatdata prefix, while Cloud Save V2 used to scan only the
 * launcher prefix Hydra would pass to umu — so the saves "disappeared".
 *
 * When Hydra has no usable prefix of its own for the game, we adopt the
 * Steam one so both launch paths share the same save environment.
 */
export const findSteamCompatibilityPrefixForApp = async (
  appId: string
): Promise<string | null> => {
  const libraryFolders = await getSteamLibraryFolders().catch(() => []);

  if (libraryFolders.length === 0) {
    return null;
  }

  const prefixPath = findSteamCompatibilityPrefixInLibraries(
    libraryFolders,
    appId,
    (candidatePath) => {
      try {
        return Wine.validatePrefix(candidatePath);
      } catch {
        return false;
      }
    }
  );

  if (prefixPath) {
    logger.info(
      "[Cloud Save] Found Steam Proton prefix for game",
      appId,
      prefixPath
    );
  }

  return prefixPath;
};
