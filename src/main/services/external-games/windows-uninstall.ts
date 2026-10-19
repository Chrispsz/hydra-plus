import { createHash } from "node:crypto";
import path from "node:path";

import type { ExternalGameCandidate } from "@types";

import {
  listRegistryKeys,
  readRegistryValue,
} from "./windows-registry-reader.js";

/**
 * Windows uninstall-registry scanner. Uninstall entries are the closest
 * Windows has to an application catalogue: every installer that follows
 * the rules registers DisplayName/DisplayIcon here. Not all of them are
 * games, so candidates are returned without a game hint (capped) and the
 * user picks in the import modal.
 */

const UNINSTALL_REGISTRY_KEY =
  "\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const MAX_UNINSTALL_CANDIDATES = 200;

export interface WindowsUninstallLocation {
  hive: "HKCU" | "HKLM";
  arch?: "x64" | "x86";
}

export interface WindowsUninstallScanDeps {
  listRegistryKeys: (options: {
    hive: "HKCU" | "HKLM";
    key: string;
    arch?: string;
  }) => Promise<string[]>;
  readRegistryValue: (options: {
    hive: "HKCU" | "HKLM";
    key: string;
    value: string;
    arch?: string;
  }) => Promise<string | null>;
  /** Registry locations to enumerate (defaults to both HKLM views). */
  locations?: WindowsUninstallLocation[];
}

const DEFAULT_LOCATIONS: WindowsUninstallLocation[] = [
  { hive: "HKCU" },
  { hive: "HKLM", arch: "x64" },
  { hive: "HKLM", arch: "x86" },
];

/**
 * DisplayIcon values point at the executable (",N" icon-index suffix),
 * sometimes quoted: `"C:\Games\Game\game.exe",0` → `C:\Games\Game\game.exe`.
 */
const normalizeDisplayIcon = (rawValue: string): string | null => {
  const withoutIconIndex = rawValue.trim().replace(/,\d+$/, "").trim();
  const unquoted = withoutIconIndex.replace(/^"(.*)"$/, "$1");
  if (!/\.exe$/i.test(unquoted)) return null;
  return path.win32.normalize(unquoted);
};

const buildUninstallCandidateId = (
  title: string,
  executablePath: string
): string =>
  `windows-registry-${createHash("sha256")
    .update(`${title}\0${executablePath}`)
    .digest("hex")
    .slice(0, 16)}`;

/** Pure candidate builder — registry access is injected. */
export const buildWindowsUninstallCandidates = async (
  deps: WindowsUninstallScanDeps
): Promise<ExternalGameCandidate[]> => {
  const locations = deps.locations ?? DEFAULT_LOCATIONS;
  const candidates: ExternalGameCandidate[] = [];
  const seenIds = new Set<string>();

  for (const location of locations) {
    const subkeyNames = await deps
      .listRegistryKeys({
        hive: location.hive,
        key: UNINSTALL_REGISTRY_KEY,
        ...(location.arch ? { arch: location.arch } : {}),
      })
      .catch(() => []);

    for (const subkeyName of subkeyNames) {
      if (!subkeyName) continue;
      const subkey = path.win32.join(UNINSTALL_REGISTRY_KEY, subkeyName);
      const [displayName, displayIcon] = await Promise.all([
        deps
          .readRegistryValue({
            hive: location.hive,
            key: subkey,
            value: "DisplayName",
            ...(location.arch ? { arch: location.arch } : {}),
          })
          .catch(() => null),
        deps
          .readRegistryValue({
            hive: location.hive,
            key: subkey,
            value: "DisplayIcon",
            ...(location.arch ? { arch: location.arch } : {}),
          })
          .catch(() => null),
      ]);

      const title = displayName?.trim();
      if (!title) continue;
      const executablePath = displayIcon
        ? normalizeDisplayIcon(displayIcon)
        : null;
      if (!executablePath) continue;

      const id = buildUninstallCandidateId(title, executablePath);
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      candidates.push({
        id,
        title,
        executablePath,
        iconPath: null,
        platform: "windows",
        source: "windows_registry",
        isGameHint: false,
        savePaths: [],
      });
    }
  }

  return candidates
    .sort((left, right) => left.title.localeCompare(right.title))
    .slice(0, MAX_UNINSTALL_CANDIDATES);
};

/** Real wiring: winreg against the current session (Windows only). */
export const scanWindowsUninstallEntries = async (): Promise<
  ExternalGameCandidate[]
> => {
  if (process.platform !== "win32") return [];

  return buildWindowsUninstallCandidates({
    listRegistryKeys,
    readRegistryValue,
  });
};
