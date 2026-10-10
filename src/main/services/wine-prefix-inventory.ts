import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";

import { SystemPath } from "./system-path";
import { Wine } from "./wine";
import {
  getSteamLibraryFolders,
  getSteamShortcuts,
  getSteamUsersIds,
} from "./steam";
import { isValidWinePrefixLayout } from "./steam-integration/steam-compat-prefix-core";
import { logger } from "./logger";

/**
 * Unified Wine/Proton prefix inventory.
 *
 * Every launcher on the system keeps prefixes in its own place. This module
 * maps them ALL so save discovery can look inside every one of them:
 *
 *   Steam        <library>/steamapps/compatdata/<appid>/pfx   (incl. non-Steam shortcut hashes)
 *   Heroic       ~/.config/heroic/GamesConfig/*.json          (native + Flatpak)
 *   Lutris       <config|data>/lutris/games/*.yml             (game.prefix)
 *   Bottles      <data>/bottles/bottles/<name>/               (native + Flatpak)
 *   umu          ~/Games/umu/<gameid>
 *   Hydra        userData/wine-prefixes/<objectId>
 *   Generic      ~/.wine
 */

const MAX_PREFIXES_PER_SOURCE = 400;
const MAX_COMPAT_ENTRIES_PER_LIBRARY = 500;

export type WinePrefixSource =
  | "steam-compatdata"
  | "heroic"
  | "lutris"
  | "bottles"
  | "umu"
  | "hydra"
  | "generic-wine";

export interface SystemWinePrefix {
  /** Directory that contains `drive_c` (the actual prefix). */
  prefixPath: string;
  source: WinePrefixSource;
  /** Human-friendly label shown in the discovery UI. */
  label: string;
}

const isValidPrefix = (candidate: string): boolean => {
  try {
    return (
      fs.statSync(candidate).isDirectory() && isValidWinePrefixLayout(candidate)
    );
  } catch {
    return false;
  }
};

const expandHome = (value: string): string => {
  const home = SystemPath.getPath("home") || os.homedir();
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(home, value.slice(2));
  }
  return value.replace(/^\$HOME(?=\/|\\|$)/, home);
};

const normalizeSeparator = (value: string) => value.replaceAll("\\", "/");

/** True when a path sits inside another path (already covered by it). */
const isSameOrInside = (candidate: string, root: string) => {
  const left = normalizeSeparator(path.resolve(candidate)).toLowerCase();
  const right = normalizeSeparator(path.resolve(root)).toLowerCase();
  return left === right || left.startsWith(`${right}/`);
};

/* ---------------------------------- Steam --------------------------------- */

const readSteamAppNames = async (libraryFolders: string[]) => {
  const names = new Map<string, string>();

  for (const library of libraryFolders) {
    const steamapps = path.join(library, "steamapps");
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(steamapps);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifestMatch = /^appmanifest_(\d+)\.acf$/i.exec(entry);
      if (!manifestMatch) continue;

      try {
        const content = await fs.promises.readFile(
          path.join(steamapps, entry),
          "utf8"
        );
        const nameMatch = /"name"\s+"([^"]+)"/.exec(content);
        if (nameMatch) names.set(manifestMatch[1], nameMatch[1]);
      } catch {
        // unreadable manifest — the id label is good enough
      }
    }
  }

  return names;
};

const readSteamShortcutNames = async () => {
  const names = new Map<string, string>();
  const userIds = await getSteamUsersIds().catch(() => []);

  for (const userId of userIds) {
    const shortcuts = await getSteamShortcuts(userId).catch(() => []);
    for (const shortcut of shortcuts) {
      if (!shortcut?.appid || !shortcut?.appname) continue;
      names.set(String(shortcut.appid), shortcut.appname);
    }
  }

  return names;
};

const discoverSteamCompatPrefixes = async (): Promise<SystemWinePrefix[]> => {
  if (process.platform === "win32") return [];

  const libraryFolders = await getSteamLibraryFolders().catch(() => []);
  const [appNames, shortcutNames] = await Promise.all([
    readSteamAppNames(libraryFolders),
    readSteamShortcutNames().catch(() => new Map<string, string>()),
  ]);

  const prefixes: SystemWinePrefix[] = [];

  for (const library of libraryFolders) {
    const compatData = path.join(library, "steamapps", "compatdata");
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(compatData, { withFileTypes: true });
    } catch {
      continue;
    }

    let visited = 0;
    for (const entry of entries) {
      if (visited >= MAX_COMPAT_ENTRIES_PER_LIBRARY) break;
      if (!entry.isDirectory()) continue;
      visited += 1;

      const prefixPath = path.join(compatData, entry.name, "pfx");
      if (!isValidPrefix(prefixPath)) continue;

      const name = appNames.get(entry.name) ?? shortcutNames.get(entry.name);
      const label = name ? `Steam · ${name}` : `Steam · prefix ${entry.name}`;

      prefixes.push({ prefixPath, source: "steam-compatdata", label });
      if (prefixes.length >= MAX_PREFIXES_PER_SOURCE) return prefixes;
    }
  }

  return prefixes;
};

/* --------------------------------- Heroic --------------------------------- */

const HEROIC_CONFIG_ROOTS = (homePath: string) => [
  path.join(homePath, ".config", "heroic"),
  path.join(
    homePath,
    ".var",
    "app",
    "com.heroicgameslauncher.hgl",
    "config",
    "heroic"
  ),
];

const discoverHeroicPrefixes = async (): Promise<SystemWinePrefix[]> => {
  if (process.platform === "win32") return [];

  const homePath = SystemPath.getPath("home");
  const prefixes: SystemWinePrefix[] = [];

  for (const heroicRoot of HEROIC_CONFIG_ROOTS(homePath)) {
    const gamesConfigDir = path.join(heroicRoot, "GamesConfig");
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(gamesConfigDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(".json")) continue;
      if (prefixes.length >= MAX_PREFIXES_PER_SOURCE) return prefixes;

      try {
        const content = await fs.promises.readFile(
          path.join(gamesConfigDir, entry),
          "utf8"
        );
        const config = YAML.parse(content) as {
          winePrefix?: string;
          wineVersion?: { type?: string } | null;
        } | null;

        const winePrefix = config?.winePrefix;
        if (!winePrefix || typeof winePrefix !== "string") continue;

        const configuredPath = expandHome(winePrefix);
        // Proton games build the prefix inside "<winePrefix>/pfx".
        const candidates = [path.join(configuredPath, "pfx"), configuredPath];
        for (const candidate of candidates) {
          if (!isValidPrefix(candidate)) continue;

          prefixes.push({
            prefixPath: candidate,
            source: "heroic",
            label: `Heroic · ${path.basename(entry, ".json")}`,
          });
          break;
        }
      } catch (error) {
        logger.debug("Failed to read Heroic game config", {
          entry,
          error: String(error),
        });
      }
    }
  }

  return prefixes;
};

/* --------------------------------- Lutris --------------------------------- */

const LUTRIS_CONFIG_ROOTS = (homePath: string) => [
  path.join(homePath, ".config", "lutris", "games"),
  path.join(homePath, ".local", "share", "lutris", "games"),
];

const readLutrisPrefix = (content: string): string | null => {
  try {
    const parsed = YAML.parse(content) as {
      game?: { prefix?: string; exe?: string } | null;
    } | null;

    const prefix = parsed?.game?.prefix;
    return prefix && typeof prefix === "string" ? prefix : null;
  } catch {
    return null;
  }
};

const discoverLutrisPrefixes = async (): Promise<SystemWinePrefix[]> => {
  if (process.platform === "win32") return [];

  const homePath = SystemPath.getPath("home");
  const prefixes: SystemWinePrefix[] = [];

  for (const gamesDir of LUTRIS_CONFIG_ROOTS(homePath)) {
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(gamesDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(".yml")) continue;
      if (prefixes.length >= MAX_PREFIXES_PER_SOURCE) return prefixes;

      try {
        const content = await fs.promises.readFile(
          path.join(gamesDir, entry),
          "utf8"
        );
        const prefix = readLutrisPrefix(content);
        if (!prefix) continue;

        const prefixPath = expandHome(prefix);
        if (!isValidPrefix(prefixPath)) continue;

        prefixes.push({
          prefixPath,
          source: "lutris",
          label: `Lutris · ${path.basename(entry, ".yml")}`,
        });
      } catch (error) {
        logger.debug("Failed to read Lutris game config", {
          entry,
          error: String(error),
        });
      }
    }
  }

  return prefixes;
};

/* --------------------------------- Bottles -------------------------------- */

const BOTTLES_ROOTS = (homePath: string) => [
  path.join(homePath, ".local", "share", "bottles", "bottles"),
  path.join(
    homePath,
    ".var",
    "app",
    "com.usebottles.bottles",
    "data",
    "bottles",
    "bottles"
  ),
];

const discoverBottlesPrefixes = async (): Promise<SystemWinePrefix[]> => {
  if (process.platform === "win32") return [];

  const homePath = SystemPath.getPath("home");
  const prefixes: SystemWinePrefix[] = [];

  for (const bottlesRoot of BOTTLES_ROOTS(homePath)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(bottlesRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (prefixes.length >= MAX_PREFIXES_PER_SOURCE) return prefixes;

      const prefixPath = path.join(bottlesRoot, entry.name);
      const bottleConfig = path.join(prefixPath, "bottle.yml");
      if (!isValidPrefix(prefixPath) || !fs.existsSync(bottleConfig)) continue;

      prefixes.push({
        prefixPath,
        source: "bottles",
        label: `Bottles · ${entry.name}`,
      });
    }
  }

  return prefixes;
};

/* ------------------------- umu / Hydra / generic -------------------------- */

const scanPrefixContainers = (
  containers: Array<{
    root: string;
    source: WinePrefixSource;
    labelPrefix: string;
  }>,
  prefixes: SystemWinePrefix[]
) => {
  for (const container of containers) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(container.root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (prefixes.length >= MAX_PREFIXES_PER_SOURCE) return;

      const prefixPath = path.join(container.root, entry.name);
      if (!isValidPrefix(prefixPath)) continue;

      prefixes.push({
        prefixPath,
        source: container.source,
        label: `${container.labelPrefix} · ${entry.name}`,
      });
    }
  }
};

const discoverLocalPrefixes = (): SystemWinePrefix[] => {
  const prefixes: SystemWinePrefix[] = [];
  const homePath = SystemPath.getPath("home");

  const containers: Array<{
    root: string;
    source: WinePrefixSource;
    labelPrefix: string;
  }> = [
    {
      root: path.join(homePath, "Games", "umu"),
      source: "umu",
      labelPrefix: "umu",
    },
  ];

  const hydraDefaultPrefixRoot = Wine.getDefaultPrefixPath();
  if (hydraDefaultPrefixRoot) {
    containers.push({
      root: hydraDefaultPrefixRoot,
      source: "hydra",
      labelPrefix: "Hydra",
    });
  }

  scanPrefixContainers(containers, prefixes);

  if (process.platform !== "win32") {
    const defaultWine = path.join(homePath, ".wine");
    if (isValidPrefix(defaultWine)) {
      prefixes.push({
        prefixPath: defaultWine,
        source: "generic-wine",
        label: "Wine · ~/.wine",
      });
    }
  }

  return prefixes;
};

/* --------------------------------- Facade --------------------------------- */

const dedupePrefixes = (prefixes: SystemWinePrefix[]): SystemWinePrefix[] => {
  const byPath = new Map<string, SystemWinePrefix>();

  for (const prefix of prefixes) {
    try {
      const realPath = fs.realpathSync(prefix.prefixPath);
      const key = realPath.toLowerCase();
      const existing = byPath.get(key);
      if (!existing) {
        byPath.set(key, { ...prefix, prefixPath: realPath });
        continue;
      }
      // Keep the friendlier label when two launchers share a prefix.
      if (
        existing.source === "generic-wine" ||
        (existing.source === "hydra" && prefix.source !== "generic-wine")
      ) {
        byPath.set(key, { ...prefix, prefixPath: realPath });
      }
    } catch {
      // vanished between listing and validation — skip
    }
  }

  return Array.from(byPath.values());
};

/**
 * Every Wine/Proton prefix this system currently exposes, across all
 * launchers. Best effort — never throws.
 */
export const discoverSystemWinePrefixes = async (): Promise<
  SystemWinePrefix[]
> => {
  if (process.platform === "win32") return [];

  const [
    steamPrefixes,
    heroicPrefixes,
    lutrisPrefixes,
    bottlesPrefixes,
    localPrefixes,
  ] = await Promise.all([
    discoverSteamCompatPrefixes().catch((error) => {
      logger.warn("Steam compat prefix discovery failed", String(error));
      return [] as SystemWinePrefix[];
    }),
    discoverHeroicPrefixes().catch((error) => {
      logger.warn("Heroic prefix discovery failed", String(error));
      return [] as SystemWinePrefix[];
    }),
    discoverLutrisPrefixes().catch((error) => {
      logger.warn("Lutris prefix discovery failed", String(error));
      return [] as SystemWinePrefix[];
    }),
    discoverBottlesPrefixes().catch((error) => {
      logger.warn("Bottles prefix discovery failed", String(error));
      return [] as SystemWinePrefix[];
    }),
    Promise.resolve(discoverLocalPrefixes()),
  ]);

  return dedupePrefixes([
    ...steamPrefixes,
    ...heroicPrefixes,
    ...lutrisPrefixes,
    ...bottlesPrefixes,
    ...localPrefixes,
  ]);
};

/** Whether a discovered prefix should be skipped for a given game scan. */
export const isPrefixCoveredByGame = (
  prefixPath: string,
  gamePrefixPaths: Array<string | null | undefined>
): boolean =>
  gamePrefixPaths.some(
    (gamePrefix) => gamePrefix && isSameOrInside(prefixPath, gamePrefix)
  );
