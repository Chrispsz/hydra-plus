import type { ExternalGameCandidate, Game } from "@types";

import { scanLinuxDesktopEntries } from "./desktop-entries.js";
import { scanHytaleCandidates } from "./hytale.js";
import { scanWindowsUninstallEntries } from "./windows-uninstall.js";

/**
 * External-games orchestrator: runs the platform scanners, drops
 * candidates already covered by the library, dedupes and orders the rest.
 * Hytale candidates surface first, then entries the scan can identify as
 * games, then everything else alphabetically — the import modal just
 * renders the list.
 */

export interface ExternalGameScanDeps {
  platform: string;
  /** Library games (already filtered to non-deleted by the caller). */
  getLibraryGames: () => Promise<Game[]>;
  scanHytale: () => Promise<ExternalGameCandidate[]>;
  scanDesktopEntries: () => Promise<ExternalGameCandidate[]>;
  scanUninstallEntries: () => Promise<ExternalGameCandidate[]>;
}

export const createExternalGameScanDeps = (options: {
  platform?: string;
  getLibraryGames: () => Promise<Game[]>;
}): ExternalGameScanDeps => ({
  platform: options.platform ?? process.platform,
  getLibraryGames: options.getLibraryGames,
  scanHytale: scanHytaleCandidates,
  scanDesktopEntries: async () => scanLinuxDesktopEntries(),
  scanUninstallEntries: scanWindowsUninstallEntries,
});

const normalizeExecutableKey = (
  executablePath: string,
  platform: string
): string =>
  platform === "win32" ? executablePath.toLowerCase() : executablePath;

/** A candidate whose executable or custom-game title is already in the library. */
export const isRegisteredLibraryCandidate = (
  candidate: ExternalGameCandidate,
  libraryGames: Game[],
  platform: string
): boolean => {
  if (candidate.executablePath) {
    const candidateKey = normalizeExecutableKey(
      candidate.executablePath,
      platform
    );
    const libraryMatch = libraryGames.some(
      (game) =>
        game.executablePath &&
        normalizeExecutableKey(game.executablePath, platform) === candidateKey
    );
    if (libraryMatch) return true;
  }

  return libraryGames.some(
    (game) => game.shop === "custom" && game.title === candidate.title
  );
};

/** Dedupe by resolved executablePath, plus title+source for Hytale roots. */
export const dedupeExternalGameCandidates = (
  candidates: ExternalGameCandidate[],
  platform: string
): ExternalGameCandidate[] => {
  const seenExecutableKeys = new Set<string>();
  const seenHytaleTitles = new Set<string>();
  const deduped: ExternalGameCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.source === "hytale") {
      const titleKey = `${candidate.title}\0${candidate.source}`;
      if (seenHytaleTitles.has(titleKey)) continue;
      seenHytaleTitles.add(titleKey);
    }

    if (candidate.executablePath) {
      const executableKey = normalizeExecutableKey(
        candidate.executablePath,
        platform
      );
      if (seenExecutableKeys.has(executableKey)) continue;
      seenExecutableKeys.add(executableKey);
    }

    deduped.push(candidate);
  }

  return deduped;
};

/** Hytale first, then game hints, then alphabetical by title. */
export const sortExternalGameCandidates = (
  candidates: ExternalGameCandidate[]
): ExternalGameCandidate[] =>
  [...candidates].sort((left, right) => {
    const leftHytale = left.source === "hytale" ? 0 : 1;
    const rightHytale = right.source === "hytale" ? 0 : 1;
    if (leftHytale !== rightHytale) return leftHytale - rightHytale;
    if (left.isGameHint !== right.isGameHint) {
      return left.isGameHint ? -1 : 1;
    }
    return left.title.localeCompare(right.title);
  });

export const scanExternalGames = async (
  deps: ExternalGameScanDeps
): Promise<ExternalGameCandidate[]> => {
  const [hytaleCandidates, desktopCandidates, uninstallCandidates] =
    await Promise.all([
      deps.scanHytale().catch(() => [] as ExternalGameCandidate[]),
      deps.scanDesktopEntries().catch(() => [] as ExternalGameCandidate[]),
      deps.scanUninstallEntries().catch(() => [] as ExternalGameCandidate[]),
    ]);
  // Hytale first: when an executable collides with a desktop entry, the
  // curated candidate (with its save matrix) must win.
  const candidates = [
    ...hytaleCandidates,
    ...desktopCandidates,
    ...uninstallCandidates,
  ];

  const libraryGames = await deps.getLibraryGames().catch(() => [] as Game[]);
  const unregistered = candidates.filter(
    (candidate) =>
      !isRegisteredLibraryCandidate(candidate, libraryGames, deps.platform)
  );

  return sortExternalGameCandidates(
    dedupeExternalGameCandidates(unregistered, deps.platform)
  );
};
