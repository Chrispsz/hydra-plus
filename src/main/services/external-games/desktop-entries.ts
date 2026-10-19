import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExternalGameCandidate } from "@types";

import { HYTALE_APP_ID } from "./hytale.js";

/**
 * Linux desktop-entry scanner. Freedesktop .desktop files describe every
 * GUI application on the system, so this returns every launchable entry
 * (with a `isGameHint` flag from the Game categories) and lets the user
 * pick what joins the library. The Hytale flatpak entry is skipped here —
 * the hytale module owns that candidate.
 */

export interface DesktopEntryScanFilesystem {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: "utf8"): string;
  readdirSync(dirPath: string): string[];
  statSync(targetPath: string): { isDirectory(): boolean };
}

export interface DesktopEntryScanDeps {
  homeDir: string;
  fs: DesktopEntryScanFilesystem;
}

const isDesktopEntryDirectory = (
  dirPath: string,
  fs: DesktopEntryScanFilesystem
): boolean => {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
};

const desktopEntryDirectories = (homeDir: string): string[] => [
  "/usr/share/applications",
  path.posix.join(homeDir, ".local", "share", "applications"),
  path.posix.join(
    homeDir,
    ".local",
    "share",
    "flatpak",
    "exports",
    "share",
    "applications"
  ),
  "/var/lib/flatpak/exports/share/applications",
];

/** Tiny INI parser — only the [Desktop Entry] section, last key wins. */
const parseDesktopEntry = (contents: string): Record<string, string> => {
  const values: Record<string, string> = {};
  let inDesktopEntrySection = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[")) {
      const sectionEnd = line.indexOf("]");
      const section =
        sectionEnd === -1 ? line.slice(1) : line.slice(1, sectionEnd);
      inDesktopEntrySection = section === "Desktop Entry";
      continue;
    }
    if (!inDesktopEntrySection) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return values;
};

/** Strip field codes (%f, %u, %%, …) and collapse the spacing they leave. */
const stripFieldCodes = (execValue: string): string =>
  execValue
    .replace(/%[a-zA-Z%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Quote-aware tokenizer that takes the first token of an Exec line. */
const tokenizeExecValue = (execValue: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of execValue) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === " " && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);

  return tokens;
};

const baseName = (value: string): string =>
  value.slice(value.lastIndexOf(path.posix.sep) + 1);

const flatpakExportBinCandidates = (homeDir: string, appId: string) => [
  path.posix.join(
    homeDir,
    ".local",
    "share",
    "flatpak",
    "exports",
    "bin",
    appId
  ),
  path.posix.join("/var/lib/flatpak/exports/bin", appId),
];

const FLATPAK_APP_ID_PATTERN =
  /^[A-Za-z0-9]+(?:-[A-Za-z0-9_]+)*\.[A-Za-z0-9]+(?:\.[A-Za-z0-9_]+)*$/;

interface ResolvedDesktopExec {
  executablePath: string | null;
  flatpakAppId: string | null;
}

const resolveDesktopExec = (
  fs: DesktopEntryScanFilesystem,
  homeDir: string,
  execValue: string
): ResolvedDesktopExec | null => {
  const tokens = tokenizeExecValue(stripFieldCodes(execValue));
  if (tokens.length === 0) return null;

  let index = 0;
  let command = tokens[0];

  // `env VAR=… <command>` wrappers: the executable is the first token
  // that is not a variable assignment.
  if (baseName(command) === "env") {
    index = 1;
    while (
      index < tokens.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])
    ) {
      index += 1;
    }
    command = tokens[index];
    if (!command) return { executablePath: null, flatpakAppId: null };
  }

  if (baseName(command) === "flatpak") {
    const runIndex = tokens.indexOf("run", index);
    let appId: string | null = null;
    for (
      let candidate = (runIndex >= 0 ? runIndex : index) + 1;
      candidate < tokens.length;
      candidate += 1
    ) {
      if (tokens[candidate].startsWith("--")) continue;
      appId = tokens[candidate];
      break;
    }
    if (appId && FLATPAK_APP_ID_PATTERN.test(appId)) {
      // Prefer the flatpak exports bin (a real executable path) over the
      // bare `flatpak run` command.
      const executablePath =
        flatpakExportBinCandidates(homeDir, appId).find((candidate) =>
          fs.existsSync(candidate)
        ) ?? null;
      return { executablePath, flatpakAppId: appId };
    }
    return { executablePath: null, flatpakAppId: appId };
  }

  // Plain commands only survive when they are absolute existing paths.
  if (path.posix.isAbsolute(command) && fs.existsSync(command)) {
    return { executablePath: command, flatpakAppId: null };
  }
  return { executablePath: null, flatpakAppId: null };
};

const GAME_DESKTOP_CATEGORIES = new Set([
  "Game",
  "ActionGame",
  "AdventureGame",
  "ArcadeGame",
  "BoardGame",
  "BlocksGame",
  "CardGame",
  "KidsGame",
  "LogicGame",
  "RolePlaying",
  "Shooter",
  "Simulation",
  "SportsGame",
  "StrategyGame",
  "Emulator",
]);

const hasGameCategory = (categories?: string): boolean =>
  (categories ?? "")
    .split(";")
    .map((category) => category.trim())
    .some((category) => GAME_DESKTOP_CATEGORIES.has(category));

const OWN_APP_NAMES = new Set(["hydra", "hydra plus"]);

const isOwnLauncherEntry = (
  entry: Record<string, string>,
  resolved: ResolvedDesktopExec | null
): boolean => {
  if (OWN_APP_NAMES.has((entry.Name ?? "").trim().toLowerCase())) return true;
  const executableBasename = resolved?.executablePath
    ? baseName(resolved.executablePath)
    : "";
  return ["hydra", "hydra-plus", "hydra_plus"].includes(
    executableBasename.toLowerCase()
  );
};

const buildDesktopEntryCandidateId = (
  title: string,
  executablePath: string | null
): string =>
  `linux-desktop-${createHash("sha256")
    .update(`${title}\0${executablePath ?? ""}`)
    .digest("hex")
    .slice(0, 16)}`;

/** Pure candidate builder — filesystem access is injected. */
export const buildDesktopEntryCandidates = (
  deps: DesktopEntryScanDeps
): ExternalGameCandidate[] => {
  const { fs, homeDir } = deps;
  const candidates: ExternalGameCandidate[] = [];
  const seenIds = new Set<string>();

  for (const directory of desktopEntryDirectories(homeDir)) {
    if (!isDesktopEntryDirectory(directory, fs)) continue;

    let fileNames: string[] = [];
    try {
      fileNames = fs
        .readdirSync(directory)
        .filter((name) => /\.desktop$/i.test(name));
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      let contents: string;
      try {
        contents = fs.readFileSync(
          path.posix.join(directory, fileName),
          "utf8"
        );
      } catch {
        continue;
      }

      const entry = parseDesktopEntry(contents);
      if (entry.Type !== "Application") continue;
      if ((entry.Terminal ?? "").toLowerCase() === "true") continue;
      if ((entry.NoDisplay ?? "").toLowerCase() === "true") continue;
      const title = entry.Name?.trim();
      if (!title) continue;

      // The hytale module owns the Hytale candidate (dedupe).
      if ((entry.Exec ?? "").includes(HYTALE_APP_ID)) continue;

      const resolved = resolveDesktopExec(fs, homeDir, entry.Exec ?? "");
      if (isOwnLauncherEntry(entry, resolved)) continue;

      const id = buildDesktopEntryCandidateId(
        title,
        resolved?.executablePath ?? null
      );
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const iconPath =
        entry.Icon && path.posix.isAbsolute(entry.Icon) ? entry.Icon : null;

      candidates.push({
        id,
        title,
        executablePath: resolved?.executablePath ?? null,
        iconPath,
        platform: "linux",
        source: "linux_desktop_entry",
        isGameHint: hasGameCategory(entry.Categories),
        savePaths: [],
      });
    }
  }

  return candidates;
};

/** Real wiring: node fs against the current session (Linux only). */
export const scanLinuxDesktopEntries = (): ExternalGameCandidate[] => {
  if (process.platform !== "linux") return [];

  const filesystem: DesktopEntryScanFilesystem = {
    existsSync: (filePath) => fs.existsSync(filePath),
    readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
    readdirSync: (dirPath) => fs.readdirSync(dirPath),
    statSync: (targetPath) => fs.statSync(targetPath),
  };

  return buildDesktopEntryCandidates({
    homeDir: os.homedir(),
    fs: filesystem,
  });
};
