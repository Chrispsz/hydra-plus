import fs from "node:fs";
import path from "node:path";

/**
 * Pure core (no service imports — unit-testable under the ts-node ESM
 * loader, following the repo's `*-core.ts` convention).
 */

const REQUIRED_PREFIX_ENTRIES: Array<{ name: string; type: "file" | "dir" }> = [
  { name: "system.reg", type: "file" },
  { name: "user.reg", type: "file" },
  { name: "userdef.reg", type: "file" },
  { name: "dosdevices", type: "dir" },
  { name: "drive_c", type: "dir" },
];

/**
 * Same contract as `Wine.validatePrefix`: a prefix is usable when the
 * registry hives and `drive_c` layout exist.
 */
export const isValidWinePrefixLayout = (prefixPath: string): boolean => {
  try {
    for (const entry of REQUIRED_PREFIX_ENTRIES) {
      const entryPath = path.join(prefixPath, entry.name);

      if (entry.type === "file" && !fs.existsSync(entryPath)) {
        return false;
      }

      if (
        entry.type === "dir" &&
        (!fs.existsSync(entryPath) || !fs.lstatSync(entryPath).isDirectory())
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Picks the first Steam library that holds a valid Proton prefix for the
 * given Steam AppID (`<library>/steamapps/compatdata/<appId>/pfx`).
 */
export const findSteamCompatibilityPrefixInLibraries = (
  libraryFolders: string[],
  appId: string,
  isPrefixValid: (prefixPath: string) => boolean = isValidWinePrefixLayout
): string | null => {
  for (const libraryFolder of libraryFolders) {
    const prefixPath = path.join(
      libraryFolder,
      "steamapps",
      "compatdata",
      appId,
      "pfx"
    );

    if (isPrefixValid(prefixPath)) {
      return prefixPath;
    }
  }

  return null;
};
