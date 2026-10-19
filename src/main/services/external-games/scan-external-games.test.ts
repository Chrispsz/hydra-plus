import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExternalGameCandidate, Game } from "@types";

import {
  dedupeExternalGameCandidates,
  isRegisteredLibraryCandidate,
  scanExternalGames,
  sortExternalGameCandidates,
  type ExternalGameScanDeps,
} from "./scan-external-games.js";

const candidate = (
  overrides: Partial<ExternalGameCandidate>
): ExternalGameCandidate => ({
  id: "candidate",
  title: "Candidate",
  executablePath: null,
  iconPath: null,
  platform: "linux",
  source: "linux_desktop_entry",
  isGameHint: false,
  savePaths: [],
  ...overrides,
});

const libraryGame = (overrides: Partial<Game>): Game =>
  ({
    title: "Library Game",
    shop: "custom",
    objectId: "object-id",
    executablePath: null,
    isDeleted: false,
    ...overrides,
  }) as Game;

const createDeps = (options: {
  platform?: string;
  hytale?: ExternalGameCandidate[];
  desktop?: ExternalGameCandidate[];
  uninstall?: ExternalGameCandidate[];
  library?: Game[];
}): ExternalGameScanDeps => ({
  platform: options.platform ?? "linux",
  getLibraryGames: async () => options.library ?? [],
  scanHytale: async () => options.hytale ?? [],
  scanDesktopEntries: async () => options.desktop ?? [],
  scanUninstallEntries: async () => options.uninstall ?? [],
});

describe("external game scan orchestrator", () => {
  it("filters candidates already registered in the library", () => {
    const libraryGames = [
      libraryGame({
        title: "Hollow Knight",
        executablePath: "/home/tester/Games/Hollow Knight/hollow-knight",
      }),
      libraryGame({ title: "Celeste", executablePath: "/opt/celeste" }),
    ];

    assert.equal(
      isRegisteredLibraryCandidate(
        candidate({
          executablePath: "/home/tester/Games/Hollow Knight/hollow-knight",
        }),
        libraryGames,
        "linux"
      ),
      true
    );
    assert.equal(
      isRegisteredLibraryCandidate(
        candidate({ title: "Celeste", executablePath: null }),
        libraryGames,
        "linux"
      ),
      true
    );
    assert.equal(
      isRegisteredLibraryCandidate(
        candidate({ title: "Hytale", executablePath: "/opt/hytale" }),
        libraryGames,
        "linux"
      ),
      false
    );
  });

  it("matches library executables case-insensitively on Windows", () => {
    const libraryGames = [
      libraryGame({ executablePath: "C:\\Games\\Celeste\\CELESTE.exe" }),
    ];

    assert.equal(
      isRegisteredLibraryCandidate(
        candidate({ executablePath: "C:\\Games\\Celeste\\celeste.EXE" }),
        libraryGames,
        "win32"
      ),
      true
    );
    assert.equal(
      isRegisteredLibraryCandidate(
        candidate({ executablePath: "C:\\Games\\Celeste\\celeste.EXE" }),
        libraryGames,
        "linux"
      ),
      false
    );
  });

  it("dedupes shared executables keeping the hytale candidate first", () => {
    const hytale = candidate({
      title: "Hytale",
      source: "hytale",
      isGameHint: true,
      savePaths: ["/home/tester/.local/share/Hytale/UserData/Saves"],
      executablePath: "/var/lib/flatpak/exports/bin/com.hypixel.HytaleLauncher",
    });
    const desktopDuplicate = candidate({
      title: "Hytale",
      executablePath: "/var/lib/flatpak/exports/bin/com.hypixel.HytaleLauncher",
    });
    const desktopOther = candidate({
      title: "Other Game",
      executablePath: "/opt/other",
    });

    const deduped = dedupeExternalGameCandidates(
      [hytale, desktopDuplicate, desktopOther],
      "linux"
    );

    assert.deepEqual(
      deduped.map(({ title }) => title),
      ["Hytale", "Other Game"]
    );
    assert.equal(deduped[0].source, "hytale");
    assert.equal(deduped[0].savePaths.length, 1);
  });

  it("dedupes hytale candidates by title and source", () => {
    const first = candidate({
      title: "Hytale",
      source: "hytale",
      executablePath: null,
    });
    const second = candidate({
      title: "Hytale",
      source: "hytale",
      executablePath: null,
    });

    const deduped = dedupeExternalGameCandidates([first, second], "linux");

    assert.equal(deduped.length, 1);
  });

  it("sorts hytale first, then game hints, then alphabetically", () => {
    const sorted = sortExternalGameCandidates([
      candidate({ title: "Zulu Tool", isGameHint: false }),
      candidate({ title: "Anvil Game", isGameHint: true }),
      candidate({ title: "Hytale", source: "hytale" }),
      candidate({ title: "Beta Game", isGameHint: true }),
    ]);

    assert.deepEqual(
      sorted.map(({ title }) => title),
      ["Hytale", "Anvil Game", "Beta Game", "Zulu Tool"]
    );
  });

  it("runs the full pipeline with injected scanners", async () => {
    const hytaleSavePath = "/home/tester/.local/share/Hytale/UserData/Saves";
    const candidates = await scanExternalGames(
      createDeps({
        platform: "linux",
        hytale: [
          candidate({
            title: "Hytale",
            source: "hytale",
            isGameHint: true,
            executablePath: null,
            savePaths: [hytaleSavePath],
          }),
        ],
        desktop: [
          candidate({
            title: "Already Owned",
            executablePath: "/opt/owned/game",
          }),
          candidate({ title: "Vim", executablePath: "/usr/bin/vim" }),
          candidate({
            title: "SuperTux",
            isGameHint: true,
            executablePath: "/usr/games/supertux2",
          }),
        ],
        library: [
          libraryGame({
            title: "Already Owned",
            executablePath: "/opt/owned/game",
          }),
        ],
      })
    );

    assert.deepEqual(
      candidates.map(({ title }) => title),
      ["Hytale", "SuperTux", "Vim"]
    );
    assert.deepEqual(candidates[0].savePaths, [hytaleSavePath]);
  });

  it("survives scanner failures with an empty contribution", async () => {
    const candidates = await scanExternalGames({
      platform: "linux",
      getLibraryGames: async () => [],
      scanHytale: async () => {
        throw new Error("scan failed");
      },
      scanDesktopEntries: async () => {
        throw new Error("scan failed");
      },
      scanUninstallEntries: async () => {
        throw new Error("scan failed");
      },
    });

    assert.deepEqual(candidates, []);
  });
});
