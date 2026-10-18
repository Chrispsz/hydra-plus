import fs from "node:fs";
import path from "node:path";

import type { ProtonInstallTarget } from "@types";
import { isWithin } from "../../helpers/is-within.js";

/**
 * Compatibility tool roots and install target resolution.
 *
 * This duplicates the small root list that `umu.ts` scans when listing
 * installed Protons. The duplication is deliberate for module isolation;
 * consolidating both into a shared root provider is a follow-up.
 */

/** Per-user Steam roots, in resolution order. */
const STEAM_ROOT_SEGMENTS: readonly (readonly string[])[] = [
  [".steam", "steam"],
  [".local", "share", "Steam"],
  [".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"],
  [".var", "app", "com.valvesoftware.Steam", "data", "Steam"],
  ["snap", "steam", "common", ".local", "share", "Steam"],
];

/** System-level compatibility tool directories (distro packages). */
const SYSTEM_COMPATIBILITY_TOOL_PATHS = [
  path.join("/usr", "lib", "steam", "compatibilitytools.d"),
  path.join("/usr", "share", "steam", "compatibilitytools.d"),
  path.join("/usr", "local", "share", "steam", "compatibilitytools.d"),
];

const HEROIC_PROTON_TOOL_PATHS = (homePath: string) => [
  path.join(homePath, ".config", "heroic", "tools", "proton"),
  path.join(
    homePath,
    ".var",
    "app",
    "com.heroicgameslauncher.hgl",
    "config",
    "heroic",
    "tools",
    "proton"
  ),
];

export const readExtraCompatToolPaths = (): string[] => {
  const raw = process.env.STEAM_EXTRA_COMPAT_TOOLS_PATHS;
  if (!raw) return [];

  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export interface ProtonInstallTargetsInput {
  homePath: string;
  libraryFolders: string[];
  extraCompatToolPaths: string[];
}

export interface CompatToolRoot {
  path: string;
  label: string;
}

export const getSteamCompatToolRoots = (homePath: string): CompatToolRoot[] => {
  const labels = [
    "Steam",
    "Steam",
    "Steam (Flatpak)",
    "Steam (Flatpak)",
    "Steam (Snap)",
  ];

  return STEAM_ROOT_SEGMENTS.map((segments, index) => ({
    path: path.join(homePath, ...segments, "compatibilitytools.d"),
    label: labels[index] ?? "Steam",
  }));
};

const getLibraryCompatToolRoots = (
  libraryFolders: string[]
): CompatToolRoot[] =>
  libraryFolders.flatMap((library) => [
    {
      path: path.join(library, "compatibilitytools.d"),
      label: "Steam library",
    },
    {
      path: path.join(library, "root", "compatibilitytools.d"),
      label: "Steam library",
    },
  ]);

const getSystemCompatToolRoots = (): CompatToolRoot[] =>
  SYSTEM_COMPATIBILITY_TOOL_PATHS.map((rootPath) => ({
    path: rootPath,
    label: "System",
  }));

const getHeroicCompatToolRoots = (homePath: string): CompatToolRoot[] =>
  HEROIC_PROTON_TOOL_PATHS(homePath).map((rootPath) => ({
    path: rootPath,
    label: "Heroic",
  }));

/**
 * Every compatibilitytool.d root the Proton listing in umu.ts knows
 * about, deduplicated, in display order.
 */
export const getCompatToolRoots = (
  input: ProtonInstallTargetsInput
): CompatToolRoot[] => {
  const roots = [
    ...getSteamCompatToolRoots(input.homePath),
    ...getLibraryCompatToolRoots(input.libraryFolders),
    ...getSystemCompatToolRoots(),
    ...getHeroicCompatToolRoots(input.homePath),
    ...input.extraCompatToolPaths.map((rootPath) => ({
      path: rootPath,
      label: "Custom",
    })),
  ];

  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root.path)) return false;
    seen.add(root.path);
    return true;
  });
};

export interface ResolvedInstallTarget {
  targetDir: string;
  isDefaultRoot: boolean;
}

const isExistingDirectory = (dirPath: string): boolean => {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
};

/**
 * First existing compatibilitytools.d among the user-writable Steam
 * roots and Steam libraries; falls back to the standard per-user Steam
 * location (created on demand by the caller).
 */
export const resolveInstallTarget = (
  input: ProtonInstallTargetsInput
): ResolvedInstallTarget => {
  const candidates = [
    ...getSteamCompatToolRoots(input.homePath),
    ...getLibraryCompatToolRoots(input.libraryFolders),
  ];

  for (const candidate of candidates) {
    if (isExistingDirectory(candidate.path)) {
      return { targetDir: candidate.path, isDefaultRoot: false };
    }
  }

  const defaultRoot = getSteamCompatToolRoots(input.homePath)[1];
  return { targetDir: defaultRoot.path, isDefaultRoot: true };
};

export const getProtonInstallTargetList = (
  input: ProtonInstallTargetsInput
): ProtonInstallTarget[] => {
  const resolved = resolveInstallTarget(input);

  return getCompatToolRoots(input).map((root) => ({
    path: root.path,
    label: root.label,
    isDefault: root.path === resolved.targetDir,
  }));
};

const resolveExistingPath = (targetPath: string): string => {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
};

export interface ProtonRemovalValidation {
  ok: boolean;
  error?: string;
}

/**
 * Removal safety gate: the path must live strictly inside a known
 * compatibility tool root (never be a root itself) and must be a
 * valid Proton build directory.
 */
export const validateProtonRemoval = (
  protonPath: string,
  roots: CompatToolRoot[],
  isValidProtonDirectory: (directoryPath: string) => boolean
): ProtonRemovalValidation => {
  const resolvedProtonPath = resolveExistingPath(protonPath);

  const isContained = roots.some((root) => {
    const resolvedRoot = resolveExistingPath(root.path);
    return (
      resolvedProtonPath !== resolvedRoot && isWithin(protonPath, root.path)
    );
  });

  if (!isContained) {
    return { ok: false, error: "proton_path_not_allowed" };
  }

  if (!isValidProtonDirectory(protonPath)) {
    return { ok: false, error: "proton_invalid_directory" };
  }

  return { ok: true };
};
