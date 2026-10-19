import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ExternalGameCandidate } from "@types";

import { readRegistryValue } from "./windows-registry-reader.js";

/**
 * Hytale candidate detection (official launcher only — Hytale is not on
 * Steam and not on Flathub; verified against the official launcher
 * binaries and the Zendesk path tables).
 *
 * Windows:  data root %APPDATA%\Hytale, client exe
 *           <root>\install\<channel>\package\game\<version>\Client\HytaleClient.exe,
 *           saves <root>\UserData\Saves, config <root>\Settings.json.
 * Linux:    Flatpak com.hypixel.HytaleLauncher keeps its data root at
 *           ~/.var/app/<id>/data/Hytale; native/portable installs use
 *           $XDG_DATA_HOME/Hytale (the data root only — the portable zip
 *           binary location is user-chosen and not discoverable).
 */

export const HYTALE_APP_ID = "com.hypixel.HytaleLauncher";

const HYTALE_REGISTRY_KEY = "\\Software\\Hypixel Studios\\Hytale";
const CLIENT_EXECUTABLE_NAME = "HytaleClient.exe";
const LAUNCHER_EXECUTABLE_NAME = "hytale-launcher.exe";

export interface HytaleScanFilesystem {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: "utf8"): string;
  readdirSync(dirPath: string): string[];
  statSync(targetPath: string): { isDirectory(): boolean };
}

export interface HytaleRegistryReader {
  (options: {
    hive: "HKCU" | "HKLM";
    key: string;
    value: string;
  }): Promise<string | null>;
}

export interface HytaleScanDeps {
  platform: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  fs: HytaleScanFilesystem;
  /** Optional Windows registry probe (win32-only in the real wiring). */
  readRegistry?: HytaleRegistryReader;
}

export interface HytaleDataRoot {
  root: string;
  hint: string;
  flatpak: boolean;
}

const isExistingDirectory = (
  fs: HytaleScanFilesystem,
  targetPath: string
): boolean => {
  try {
    return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
};

const listDirectoryNames = (
  fs: HytaleScanFilesystem,
  dirPath: string
): string[] => {
  try {
    return (
      fs
        .readdirSync(dirPath)
        // Windows-only helper (the Linux branch never lists directories):
        // path.win32.join keeps the fake-fs fixtures usable on the Linux
        // dev box, where path.join would use posix separators.
        .filter((name) =>
          isExistingDirectory(fs, path.win32.join(dirPath, name))
        )
    );
  } catch {
    return [];
  }
};

/** Well-known Hytale data roots per platform (also used by save discovery). */
export const getHytaleDataRoots = ({
  platform,
  env,
  homeDir,
}: Pick<HytaleScanDeps, "platform" | "env" | "homeDir">): HytaleDataRoot[] => {
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (!appData) return [];
    return [
      {
        root: path.win32.join(appData, "Hytale"),
        hint: "%APPDATA%\\Hytale",
        flatpak: false,
      },
    ];
  }

  // The fork targets Windows and Linux; macOS stays out of scope.
  if (platform !== "linux") return [];

  const roots: HytaleDataRoot[] = [
    {
      root: path.posix.join(
        homeDir,
        ".var",
        "app",
        HYTALE_APP_ID,
        "data",
        "Hytale"
      ),
      hint: `~/.var/app/${HYTALE_APP_ID}/data/Hytale (Flatpak)`,
      flatpak: true,
    },
  ];

  const xdgDataHome =
    env.XDG_DATA_HOME || path.posix.join(homeDir, ".local", "share");
  roots.push({
    root: path.posix.join(xdgDataHome, "Hytale"),
    hint: "$XDG_DATA_HOME/Hytale (native)",
    flatpak: false,
  });

  return roots;
};

const getSavePaths = (
  fs: HytaleScanFilesystem,
  platform: string,
  dataRoot: string
): string[] => {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return [
    pathApi.join(dataRoot, "UserData", "Saves"),
    pathApi.join(dataRoot, "Settings.json"),
  ].filter((candidate) => fs.existsSync(candidate));
};

/**
 * Settings.json may carry a `patchline` field (e.g. "pre-release"). The
 * naming of patchline data roots is unverified, so this is only used as a
 * label; "release" (the default) never surfaces.
 */
const readHytalePatchline = (
  fs: HytaleScanFilesystem,
  platform: string,
  dataRoot: string
): string | null => {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  try {
    const settingsPath = pathApi.join(dataRoot, "Settings.json");
    if (!fs.existsSync(settingsPath)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const patchline = (parsed as { patchline?: unknown } | null)?.patchline;
    if (
      typeof patchline !== "string" ||
      !patchline.trim() ||
      patchline.toLowerCase() === "release"
    ) {
      return null;
    }
    return patchline.trim();
  } catch {
    return null;
  }
};

const hasHytaleInstallEvidence = (
  fs: HytaleScanFilesystem,
  platform: string,
  dataRoot: string,
  executablePath: string | null
): boolean => {
  if (executablePath) return true;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return fs.existsSync(pathApi.join(dataRoot, "hytale-launcher.log"));
};

/**
 * Glob the two variable segments of the client path:
 * <root>\install\<channel>\package\game\<version>\Client\HytaleClient.exe.
 * "release"/"latest" win over their siblings; the rest stay alphabetical
 * (versions newest-first) so the result is deterministic.
 */
const globHytaleClientExecutable = (
  fs: HytaleScanFilesystem,
  dataRoot: string
): string | null => {
  const installDir = path.win32.join(dataRoot, "install");
  const channels = listDirectoryNames(fs, installDir).sort((left, right) => {
    const leftRank = left.toLowerCase() === "release" ? 0 : 1;
    const rightRank = right.toLowerCase() === "release" ? 0 : 1;
    return leftRank - rightRank || left.localeCompare(right);
  });

  for (const channel of channels) {
    const gameDir = path.win32.join(installDir, channel, "package", "game");
    const versions = listDirectoryNames(fs, gameDir).sort((left, right) => {
      const leftRank = left.toLowerCase() === "latest" ? 0 : 1;
      const rightRank = right.toLowerCase() === "latest" ? 0 : 1;
      return leftRank - rightRank || right.localeCompare(left);
    });

    for (const version of versions) {
      const clientExecutable = path.win32.join(
        gameDir,
        version,
        "Client",
        CLIENT_EXECUTABLE_NAME
      );
      if (fs.existsSync(clientExecutable)) return clientExecutable;
    }
  }

  return null;
};

const unquoteRegistryValue = (value: string): string =>
  value
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();

/**
 * Prefer a discoverable `hytale-launcher.exe` (registry values, then a
 * couple of root-relative guesses). Fall back to the game client exe —
 * the user can re-rank executables later in the options modal.
 */
const resolveWindowsExecutable = async (
  deps: HytaleScanDeps,
  dataRoot: string
): Promise<string | null> => {
  const { fs, env } = deps;

  if (deps.readRegistry) {
    for (const valueName of ["LauncherPath", "InstallLocation", "ExePath"]) {
      const rawValue = await deps
        .readRegistry({
          hive: "HKCU",
          key: HYTALE_REGISTRY_KEY,
          value: valueName,
        })
        .catch(() => null);
      if (!rawValue?.trim()) continue;

      const value = unquoteRegistryValue(rawValue);
      if (/\.exe$/i.test(value) && fs.existsSync(value)) return value;
      if (isExistingDirectory(fs, value)) {
        const launcherInside = path.win32.join(value, LAUNCHER_EXECUTABLE_NAME);
        if (fs.existsSync(launcherInside)) return launcherInside;
      }
    }
  }

  const appData = env.APPDATA;
  const guesses = [
    path.win32.join(dataRoot, LAUNCHER_EXECUTABLE_NAME),
    ...(appData ? [path.win32.join(appData, LAUNCHER_EXECUTABLE_NAME)] : []),
    path.win32.join(dataRoot, "..", "..", LAUNCHER_EXECUTABLE_NAME),
  ];
  const guessedLauncher = guesses.find((guess) => fs.existsSync(guess));
  if (guessedLauncher) return guessedLauncher;

  return globHytaleClientExecutable(fs, dataRoot);
};

const resolveFlatpakExecutable = (
  fs: HytaleScanFilesystem,
  homeDir: string
): string | null => {
  const candidates = [
    path.posix.join(
      homeDir,
      ".local",
      "share",
      "flatpak",
      "exports",
      "bin",
      HYTALE_APP_ID
    ),
    path.posix.join("/var/lib/flatpak/exports/bin", HYTALE_APP_ID),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const buildHytaleCandidateId = (
  title: string,
  executablePath: string | null
): string =>
  `hytale-${createHash("sha256")
    .update(`${title}\0${executablePath ?? ""}`)
    .digest("hex")
    .slice(0, 16)}`;

const buildLinuxHytaleCandidates = (
  deps: HytaleScanDeps
): ExternalGameCandidate[] => {
  const { fs, homeDir } = deps;
  const candidates: ExternalGameCandidate[] = [];

  for (const dataRoot of getHytaleDataRoots(deps)) {
    if (!isExistingDirectory(fs, dataRoot.root)) continue;

    const savePaths = getSavePaths(fs, "linux", dataRoot.root);
    const executablePath = dataRoot.flatpak
      ? resolveFlatpakExecutable(fs, homeDir)
      : // Portable zip installs keep the binary wherever the user unpacked
        // it; the modal's executable picker resolves this later.
        null;
    if (
      !hasHytaleInstallEvidence(fs, "linux", dataRoot.root, executablePath) &&
      savePaths.length === 0
    ) {
      continue;
    }

    const title = dataRoot.flatpak ? "Hytale (Flatpak)" : "Hytale";
    candidates.push({
      id: buildHytaleCandidateId(title, executablePath),
      title,
      executablePath,
      iconPath: null,
      platform: "linux",
      source: "hytale",
      isGameHint: true,
      savePaths,
    });
  }

  return candidates;
};

const buildWindowsHytaleCandidates = async (
  deps: HytaleScanDeps
): Promise<ExternalGameCandidate[]> => {
  const { fs, env } = deps;
  const appData = env.APPDATA;
  if (!appData || !isExistingDirectory(fs, appData)) return [];

  const candidates: ExternalGameCandidate[] = [];
  const hytaleDirectoryNames = listDirectoryNames(fs, appData)
    .filter((name) => /^hytale/i.test(name))
    .sort((left, right) => {
      const leftRank = left.toLowerCase() === "hytale" ? 0 : 1;
      const rightRank = right.toLowerCase() === "hytale" ? 0 : 1;
      return leftRank - rightRank || left.localeCompare(right);
    });

  for (const directoryName of hytaleDirectoryNames) {
    const dataRoot = path.win32.join(appData, directoryName);
    const savePaths = getSavePaths(fs, "win32", dataRoot);
    const isPrimaryRoot = directoryName.toLowerCase() === "hytale";

    if (!isPrimaryRoot) {
      // Unverified patchline data roots (e.g. "Hytale_pre-release") are
      // surfaced for SAVE detection only, and only when they hold saves.
      if (!fs.existsSync(path.win32.join(dataRoot, "UserData", "Saves"))) {
        continue;
      }
      const patchline = readHytalePatchline(fs, "win32", dataRoot);
      const title = `Hytale (${patchline ?? directoryName})`;
      candidates.push({
        id: buildHytaleCandidateId(title, null),
        title,
        executablePath: null,
        iconPath: null,
        platform: "windows",
        source: "hytale",
        isGameHint: true,
        savePaths,
      });
      continue;
    }

    const executablePath = await resolveWindowsExecutable(deps, dataRoot);
    if (
      !hasHytaleInstallEvidence(fs, "win32", dataRoot, executablePath) &&
      savePaths.length === 0
    ) {
      continue;
    }

    candidates.push({
      id: buildHytaleCandidateId("Hytale", executablePath),
      title: "Hytale",
      executablePath,
      iconPath: null,
      platform: "windows",
      source: "hytale",
      isGameHint: true,
      savePaths,
    });
  }

  return candidates;
};

/** Pure candidate builder — every filesystem/env/registry access is injected. */
export const buildHytaleCandidates = async (
  deps: HytaleScanDeps
): Promise<ExternalGameCandidate[]> => {
  if (deps.platform === "win32") return buildWindowsHytaleCandidates(deps);
  if (deps.platform === "linux") return buildLinuxHytaleCandidates(deps);
  return [];
};

/** Real wiring: node fs/env against the current session. */
export const scanHytaleCandidates = async (): Promise<
  ExternalGameCandidate[]
> =>
  buildHytaleCandidates({
    platform: process.platform,
    env: process.env,
    homeDir: os.homedir(),
    fs: {
      existsSync: (filePath) => fs.existsSync(filePath),
      readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
      readdirSync: (dirPath) => fs.readdirSync(dirPath),
      statSync: (targetPath) => fs.statSync(targetPath),
    },
    // The registry probe is a Windows-only affordance; the reader itself
    // also no-ops outside win32.
    readRegistry: process.platform === "win32" ? readRegistryValue : undefined,
  });
