import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  DiscoveredSaveEnvironment,
  DiscoveredSaveLocation,
  GameShop,
} from "@types";

import { getCloudSaveGameContext } from "./cloud-save/cloud-save-game-context";
import { getCloudSaveCustomPathBindings } from "./cloud-save/custom-path-store";
import { cloudSaveCustomPathContextFromPathContext } from "./cloud-save/custom-path";
import { getHytaleDataRoots } from "./external-games/hytale";
import { findSteamCompatibilityPrefixForApp } from "./steam-integration/steam-compat-prefix";
import { findInstalledSteamApp } from "./steam-integration/steam-installation-core";
import { getSteamLibraryFolders } from "./steam";
import {
  discoverSystemWinePrefixes,
  isPrefixCoveredByGame,
} from "./wine-prefix-inventory";

/**
 * System-wide save discovery.
 *
 * The ludusavi manifest covers games it knows about; this scanner covers
 * everything else: it searches every plausible save environment (Wine and
 * Proton prefixes, native XDG paths, Documents, Steam Cloud userdata, the
 * game install dir) for directories that look like this game's saves and
 * lets the user pick which ones the cloud should track. Tracked candidates
 * go through the custom-path pipeline, so syncing/restore work unchanged.
 */

const MAX_DIRS_PER_ROOT = 4000;
const MAX_FILES_PER_CANDIDATE = 2000;

const NOISE_DIR_NAMES = new Set([
  "windows",
  "system32",
  "syswow64",
  "temp",
  "tmp",
  "node_modules",
  "$recycle.bin",
  "system volume information",
  "lost+found",
  "proc",
  "sys",
  "dev",
  "run",
  "cache",
  "caches",
  "logs",
  "crashdumps",
  "mono",
  "dotnet",
  "commonredist",
  "redist",
  "__macosx",
  "bin",
  "lib",
  "lib64",
]);

const normalizeName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

interface ScanRoot {
  base: string;
  environment: DiscoveredSaveEnvironment;
  hint: string;
  /** How deep to search below the base. */
  depth: number;
  /** Confidence assigned to matches under this root. */
  confidence: "high" | "medium" | "low";
}

interface CandidateStats {
  fileCount: number;
  totalSizeBytes: number;
  lastModifiedAt: string | null;
}

const collectCandidateStats = async (
  candidatePath: string
): Promise<CandidateStats | null> => {
  let fileCount = 0;
  let totalSizeBytes = 0;
  let lastModifiedAt: string | null = null;
  let truncated = false;

  const stack: string[] = [candidatePath];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;
      const entryPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(entryPath);
      } else if (dirent.isFile()) {
        fileCount += 1;
        try {
          const stat = await fs.promises.stat(entryPath);
          totalSizeBytes += stat.size;
          const mtime = stat.mtime.toISOString();
          if (!lastModifiedAt || mtime > lastModifiedAt) {
            lastModifiedAt = mtime;
          }
        } catch {
          // unreadable file — still counts as content
        }
        if (fileCount >= MAX_FILES_PER_CANDIDATE) {
          truncated = true;
          break;
        }
      }
    }
    if (truncated) break;
  }

  if (fileCount === 0) return null;
  return { fileCount, totalSizeBytes, lastModifiedAt };
};

/** Depth-first search for directories whose name matches any slug. */
const findMatchingDirectories = async (
  root: ScanRoot,
  matchers: Set<string>
): Promise<string[]> => {
  const matches: string[] = [];
  let visited = 0;

  // Directory names are often decorated with editions/platforms
  // ("Blasphemous Deluxe", "Game GOG"). Exact match wins; when no exact
  // match exists a substring hit on a reasonably long name is accepted —
  // the user still confirms every candidate before it is tracked.
  const substringMatchers = [...matchers].filter(
    (matcher) => matcher.length >= 6
  );

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > root.depth || visited >= MAX_DIRS_PER_ROOT) return;
    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (visited >= MAX_DIRS_PER_ROOT) return;
      if (dirent.isSymbolicLink()) continue;
      if (!dirent.isDirectory()) continue;
      const name = dirent.name;
      if (NOISE_DIR_NAMES.has(name.toLowerCase())) continue;
      const entryPath = path.join(dir, name);
      visited += 1;
      const normalized = normalizeName(name);
      const isMatch =
        matchers.has(normalized) ||
        substringMatchers.some(
          (matcher) =>
            (normalized.length >= 6 && normalized.includes(matcher)) ||
            (matcher.length >= 6 &&
              matcher.includes(normalized) &&
              normalized.length >= 6)
        );
      if (isMatch) {
        matches.push(entryPath);
        // Still descend: nested matches (e.g. a versioned profile folder)
        // are rare, but the root itself already matched — stop descending
        // into matched trees to keep the scan bounded and relevant.
        continue;
      }
      await walk(entryPath, depth + 1);
    }
  };

  await walk(root.base, 1);
  return matches;
};

const buildNameMatchers = (
  gameTitle?: string,
  executablePath?: string,
  objectId?: string,
  additionalTitles: Array<string | null | undefined> = []
): Set<string> => {
  const matchers = new Set<string>();
  const add = (value?: string | null) => {
    const normalized = normalizeName((value ?? "").trim());
    if (normalized.length >= 3) matchers.add(normalized);
  };

  add(gameTitle);
  for (const title of additionalTitles) add(title);

  if (executablePath) {
    const basename = path.basename(executablePath);
    add(basename.replace(/\.exe$/i, ""));
    // Many installers name the save folder after the exe directory.
    add(path.basename(path.dirname(executablePath)));
  }

  // Steam app ids are never good directory names on their own — only add
  // the object id when it looks like one and the title is unavailable.
  if (matchers.size === 0 && objectId && /^\d{2,12}$/.test(objectId)) {
    add(objectId);
  }

  return matchers;
};

interface PrefixUserDirectory {
  base: string;
  depth: number;
}

const prefixUserDirectories = (prefixPath: string): PrefixUserDirectory[] => {
  const usersRoot = path.join(prefixPath, "drive_c", "users");
  let users: string[] = [];
  try {
    users = fs
      .readdirSync(usersRoot, { withFileTypes: true })
      .filter(
        (dirent) =>
          dirent.isDirectory() &&
          !["public", "all users", "default"].includes(
            dirent.name.toLowerCase()
          )
      )
      .map((dirent) => dirent.name);
  } catch {
    return [];
  }

  const candidates: PrefixUserDirectory[] = [];
  for (const user of users) {
    const userProfile = path.join(usersRoot, user);
    for (const [relative, depth] of [
      ["Documents", 2],
      ["My Documents", 2],
      ["Saved Games", 2],
      // AppData trees nest one level deeper in practice
      // (e.g. Roaming/<company>/<launcher>/<game>/saves).
      [path.join("AppData", "Roaming"), 3],
      [path.join("AppData", "Local"), 3],
      [path.join("AppData", "LocalLow"), 3],
      ["Documents/My Games", 2],
    ] as Array<[string, number]>) {
      const dir = path.join(userProfile, ...relative.split("/"));
      try {
        if (fs.statSync(dir).isDirectory())
          candidates.push({ base: dir, depth });
      } catch {
        // missing — fine
      }
    }
  }

  // Some installers write shared saves under ProgramData.
  const programData = path.join(prefixPath, "drive_c", "ProgramData");
  try {
    if (fs.statSync(programData).isDirectory()) {
      candidates.push({ base: programData, depth: 2 });
    }
  } catch {
    // missing — fine
  }

  return candidates;
};

const buildScanRoots = (options: {
  homeDir: string;
  documentsDir?: string;
  winePrefixPath?: string;
  steamCompatPrefixPath?: string;
  executablePath?: string;
}): ScanRoot[] => {
  const roots: ScanRoot[] = [];
  const {
    homeDir,
    documentsDir,
    winePrefixPath,
    steamCompatPrefixPath,
    executablePath,
  } = options;

  for (const prefix of [steamCompatPrefixPath, winePrefixPath]) {
    if (!prefix) continue;
    for (const userDir of prefixUserDirectories(prefix)) {
      roots.push({
        base: userDir.base,
        environment:
          prefix === steamCompatPrefixPath ? "steam-proton" : "wine-prefix",
        hint: prefix,
        depth: userDir.depth,
        confidence: "high",
      });
    }
  }

  if (documentsDir) {
    roots.push({
      base: documentsDir,
      environment: "documents",
      hint: documentsDir,
      depth: 2,
      confidence: "high",
    });
  }

  const home = homeDir || os.homedir();
  roots.push({
    base: path.join(home, ".local", "share"),
    environment: "native",
    hint: "~/.local/share",
    depth: 2,
    confidence: "high",
  });
  roots.push({
    base: path.join(home, ".config"),
    environment: "native",
    hint: "~/.config",
    depth: 2,
    confidence: "high",
  });

  // Engine-specific roots: the generic XDG roots above cannot reach
  // <engine>/<company>/<game> at depth 2, so native engine saves
  // (Unity, Godot, Ren'Py) get their own shallow roots.
  for (const [engineBase, hint] of [
    [path.join(home, ".config", "unity3d"), "~/.config/unity3d (Unity)"],
    [
      path.join(home, ".local", "share", "unity3d"),
      "~/.local/share/unity3d (Unity)",
    ],
    [
      path.join(home, ".local", "share", "godot", "app_userdata"),
      "Godot app_userdata",
    ],
    [path.join(home, ".renpy"), "Ren'Py saves"],
  ]) {
    roots.push({
      base: engineBase,
      environment: "native",
      hint,
      depth: 1,
      confidence: "high",
    });
  }

  roots.push({
    base: path.join(home, ".steam", "steam", "userdata"),
    environment: "steam-cloud-userdata",
    hint: "Steam Cloud (userdata)",
    depth: 1,
    confidence: "high",
  });

  if (executablePath) {
    const installDir = path.dirname(executablePath);
    roots.push({
      base: installDir,
      environment: "install-dir",
      hint: installDir,
      depth: 2,
      confidence: "medium",
    });
  }

  return roots;
};

/**
 * Scan roots for every OTHER launcher prefix on the system (Steam
 * compatdata across all libraries, Heroic, Lutris, Bottles, umu, ~/.wine).
 * This is the "unified prefix" pass: a game installed under Heroic while
 * Hydra plays it through umu still gets its saves found.
 */
const buildSystemPrefixRoots = async (
  gamePrefixPaths: Array<string | null | undefined>
): Promise<ScanRoot[]> => {
  const roots: ScanRoot[] = [];
  const systemPrefixes = await discoverSystemWinePrefixes().catch(() => []);

  for (const prefix of systemPrefixes) {
    if (isPrefixCoveredByGame(prefix.prefixPath, gamePrefixPaths)) continue;
    for (const userDir of prefixUserDirectories(prefix.prefixPath)) {
      roots.push({
        base: userDir.base,
        environment:
          prefix.source === "steam-compatdata" ? "steam-proton" : "wine-prefix",
        hint: prefix.label,
        depth: userDir.depth,
        confidence: "medium",
      });
    }
  }

  return roots;
};

/** Resolve every path a custom binding currently points to. */
const resolveTrackedCustomPaths = async (
  objectId: string,
  shop: GameShop
): Promise<Set<string>> => {
  try {
    const context = await getCloudSaveGameContext(objectId, shop);
    const customPathContext = cloudSaveCustomPathContextFromPathContext(
      context.pathContext
    );
    const bindings = await getCloudSaveCustomPathBindings(
      shop,
      objectId,
      customPathContext
    );
    return new Set(bindings.ready.map((binding) => path.resolve(binding.path)));
  } catch {
    return new Set();
  }
};

export const discoverGameSaveLocations = async (
  objectId: string,
  shop: GameShop
): Promise<DiscoveredSaveLocation[]> => {
  const context = await getCloudSaveGameContext(objectId, shop);
  const { pathContext, game } = context;

  // The Steam manifest title is the strongest matcher for Steam games:
  // the Hydra title may differ (localized names, editions, shortcuts).
  const additionalTitles: Array<string | null | undefined> = [];
  if (/^\d+$/.test(objectId)) {
    try {
      const libraryFolders = await getSteamLibraryFolders();
      const installedApp = await findInstalledSteamApp(
        objectId,
        libraryFolders
      );
      if (installedApp?.name) additionalTitles.push(installedApp.name);
    } catch {
      // Steam not installed / manifest missing — fine.
    }
  }

  const matchers = buildNameMatchers(
    game?.title,
    pathContext.executablePath,
    objectId,
    additionalTitles
  );
  if (matchers.size === 0) return [];

  // Steam Proton prefix (adopted or via appid lookup).
  let steamCompatPrefixPath: string | undefined;
  if (shop === "steam" || /^\d+$/.test(objectId)) {
    steamCompatPrefixPath =
      (await findSteamCompatibilityPrefixForApp(objectId).catch(() => null)) ??
      undefined;
  }

  const roots = buildScanRoots({
    homeDir: pathContext.homeDir,
    documentsDir: pathContext.documentsDir,
    winePrefixPath: pathContext.winePrefixPath,
    steamCompatPrefixPath,
    executablePath: pathContext.executablePath,
  });

  // Every other prefix on the system (all Steam libraries, Heroic,
  // Lutris, Bottles, umu, ~/.wine) joins the scan at medium confidence.
  roots.push(
    ...(await buildSystemPrefixRoots([
      pathContext.winePrefixPath,
      steamCompatPrefixPath,
    ]))
  );

  const trackedPaths = await resolveTrackedCustomPaths(objectId, shop);
  const seen = new Set<string>();
  const locations: DiscoveredSaveLocation[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root.base)) continue;
    const matches = await findMatchingDirectories(root, matchers);
    for (const matchPath of matches) {
      const resolved = path.resolve(matchPath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const stats = await collectCandidateStats(resolved);
      if (!stats) continue;

      locations.push({
        absolutePath: resolved,
        environment: root.environment,
        environmentHint: root.hint,
        matchReason: "name matches the game",
        fileCount: stats.fileCount,
        totalSizeBytes: stats.totalSizeBytes,
        lastModifiedAt: stats.lastModifiedAt,
        confidence: root.confidence,
        tracked: trackedPaths.has(resolved),
      });
    }
  }

  // Hytale (launcher-managed): the save folder is a fixed subfolder of
  // the launcher data root on every platform, so the generic name scan
  // cannot surface it. Curated roots, same shape as the Steam Cloud block
  // below — but keyed by the Hytale data-root table.
  if (isHytaleGameMatcher(matchers)) {
    for (const dataRoot of getHytaleDataRoots({
      platform: process.platform,
      env: process.env,
      homeDir: pathContext.homeDir,
    })) {
      const savesDir = path.join(dataRoot.root, "UserData", "Saves");
      try {
        if (!fs.statSync(savesDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const resolved = path.resolve(savesDir);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const stats = await collectCandidateStats(resolved);
      if (!stats) continue;

      locations.push({
        absolutePath: resolved,
        environment: "native",
        environmentHint: dataRoot.hint,
        matchReason: "Hytale launcher save folder (UserData/Saves)",
        fileCount: stats.fileCount,
        totalSizeBytes: stats.totalSizeBytes,
        lastModifiedAt: stats.lastModifiedAt,
        confidence: "high",
        tracked: trackedPaths.has(resolved),
      });
    }
  }

  // Steam Cloud userdata folders do not carry the game name — they are
  // keyed by app id. Check them explicitly for Steam games.
  const steamLocation =
    pathContext.steamPath ?? (await getSteamLocationFallback());
  if (steamLocation) {
    const userdataRoot = path.join(steamLocation, "userdata");
    const appIds = new Set<string>([objectId]);
    if (/^\d+$/.test(objectId)) appIds.add(objectId);

    try {
      const accounts = await fs.promises.readdir(userdataRoot, {
        withFileTypes: true,
      });
      for (const account of accounts) {
        if (!account.isDirectory()) continue;
        for (const appId of appIds) {
          const remoteDir = path.join(
            userdataRoot,
            account.name,
            appId,
            "remote"
          );
          try {
            if (!fs.statSync(remoteDir).isDirectory()) continue;
          } catch {
            continue;
          }
          const resolved = path.resolve(remoteDir);
          if (seen.has(resolved)) continue;
          seen.add(resolved);
          const stats = await collectCandidateStats(resolved);
          if (!stats) continue;
          locations.push({
            absolutePath: resolved,
            environment: "steam-cloud-userdata",
            environmentHint: `account ${account.name}`,
            matchReason: "Steam Cloud remote folder for this app id",
            fileCount: stats.fileCount,
            totalSizeBytes: stats.totalSizeBytes,
            lastModifiedAt: stats.lastModifiedAt,
            confidence: "high",
            tracked: trackedPaths.has(resolved),
          });
        }
      }
    } catch {
      // No userdata folder — fine.
    }
  }

  const confidenceRank = { high: 0, medium: 1, low: 2 };
  return locations.sort((left, right) => {
    if (confidenceRank[left.confidence] !== confidenceRank[right.confidence]) {
      return confidenceRank[left.confidence] - confidenceRank[right.confidence];
    }
    return right.totalSizeBytes - left.totalSizeBytes;
  });
};

/** Exposed for tests: the name matcher derivation. */
export const buildSaveNameMatchers = buildNameMatchers;

/** True when the matchers identify the game as Hytale (title or client exe). */
const isHytaleGameMatcher = (matchers: Set<string>): boolean =>
  [...matchers].some(
    (matcher) =>
      matcher === "hytale" ||
      (matcher.length >= 6 && matcher.includes("hytale"))
  );

const getSteamLocationFallback = async (): Promise<string | null> => {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".steam", "steam"),
    path.join(home, ".local", "share", "Steam"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};
