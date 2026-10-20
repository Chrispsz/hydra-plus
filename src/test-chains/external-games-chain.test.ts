/**
 * CHAIN A — "Hytale goes to the cloud" (external games).
 *
 * One continuous scenario per sub-test: the outputs of one stage are fed,
 * unmodified, into the next module, so the assertions prove that data
 * survives the handoffs between detection, library import, cloud-save path
 * registration, decode and the automatic-sync predicate chain.
 *
 * Stage map:
 *   1. DETECT       buildHytaleCandidates (external-games/hytale.ts)
 *   2. IMPORT       registerSavePathsForCustomGame (custom-game-save-paths.ts)
 *   3. ROUNDTRIP    decodeCloudSaveCustomPath (cloud-save/custom-path.ts)
 *   4. ELIGIBILITY  isCloudSaveV2Eligible (@shared) + the automatic-sync
 *                   predicate chain (cloud-save/automatic-sync-mode.ts)
 *   5. (Linux)      DETECT repeated for flatpak + native roots
 *   6. SCAN         scanExternalGames orchestrator (scan-external-games.ts)
 *
 * Headless boundaries (honesty over coverage theater):
 *   - Scenario 1 detects a Windows install through the module's injected
 *     fs seam, so the `stat`/`realpath` shell of canonicalizeSelectedCloudSave-
 *     CustomPath cannot touch a C:\ path on the Linux CI box. Its IMPORT stage
 *     therefore chains the pure canonicalization core that shell delegates to
 *     (encodeCloudSaveCustomPath) and fakes only the stat probe. Scenario 2
 *     runs the complete real shell (real stat, realpath, symlink guard) on
 *     real on-disk paths.
 *   - Scenario 4 chains every pure predicate of canRunAutomaticCloudSaveSync.
 *     The three impure links are skipped and documented inline: the Drive
 *     link probe (drive-token-store → LevelDB), the pending-deletion probe
 *     (LevelDB sublevel) and the gamesSublevel.get (LevelDB). The in-memory
 *     game record substitutes the database read.
 *   - Only the custom-path STORE is faked (an in-memory capture object): it
 *     is the cloud-save/LevelDB seam of the real flow and holds no logic the
 *     chain needs to re-prove.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { CloudSaveCustomPath, Game, GameShop } from "@types";
import { isCloudSaveV2Eligible } from "../shared/cloud-save-v2-eligibility.js";
import { buildDesktopEntryCandidates } from "../main/services/external-games/desktop-entries.js";
import { buildHytaleCandidates } from "../main/services/external-games/hytale.js";
import { scanExternalGames } from "../main/services/external-games/scan-external-games.js";
import { scanWindowsUninstallEntries } from "../main/services/external-games/windows-uninstall.js";
import { registerSavePathsForCustomGame } from "../main/services/external-games/custom-game-save-paths.js";
import {
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  decodeCloudSaveCustomPath,
  encodeCloudSaveCustomPath,
  type CloudSaveCustomPathContext,
} from "../main/services/cloud-save/custom-path.js";
import {
  resolveStoredCloudSaveAutomaticSyncMode,
  shouldRunV2AutomaticCloudSave,
} from "../main/services/cloud-save/automatic-sync-mode.js";
import {
  createFakeFilesystem,
  createRealFilesystem,
} from "./helpers/fake-filesystem.js";
import { makeLibraryGame } from "./helpers/library-games.js";

const win = path.win32.join;
const posix = path.posix.join;

/**
 * In-memory capture of the custom-path-store registration seam — the only
 * fake in the chain that stands in for production persistence.
 */
interface CapturedRegistration {
  shop: GameShop;
  objectId: string;
  customPaths: CloudSaveCustomPath[];
  options?: { syncState?: "pending" | "confirmed" };
}

const createFakeStore = () => {
  const calls: CapturedRegistration[] = [];
  const register = async (
    shop: GameShop,
    objectId: string,
    customPaths: CloudSaveCustomPath[],
    options?: { syncState?: "pending" | "confirmed" }
  ): Promise<void> => {
    calls.push({
      shop,
      objectId,
      customPaths: customPaths.map((customPath) => ({ ...customPath })),
      options,
    });
  };
  return { calls, register };
};

describe("chain A — Hytale goes to the cloud (external games)", () => {
  it("scenario 1: Windows install → detect → import → decode roundtrip → eligibility", async () => {
    // -- fixtures: the verified Windows Hytale matrix -----------------------
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";
    const homeDir = "C:\\Users\\Tester";
    const hytaleRoot = win(appData, "Hytale");
    const gameDir = win(hytaleRoot, "install", "release", "package", "game");
    const savesDir = win(hytaleRoot, "UserData", "Saves");
    const settingsFile = win(hytaleRoot, "Settings.json");
    const clientExecutable = win(
      gameDir,
      "latest",
      "Client",
      "HytaleClient.exe"
    );

    const fakeFs = createFakeFilesystem({
      directories: [
        appData,
        hytaleRoot,
        win(hytaleRoot, "install"),
        win(hytaleRoot, "install", "release"),
        win(hytaleRoot, "install", "release", "package"),
        gameDir,
        win(gameDir, "latest"),
        win(hytaleRoot, "UserData"),
        savesDir,
        win(savesDir, "EmeraldWorld"),
      ],
      files: {
        [clientExecutable]: "MZ",
        [settingsFile]: '{"patchline":"release"}',
        [win(savesDir, "EmeraldWorld", "preview.png")]: "png",
      },
    });

    // -- stage 1: DETECT ----------------------------------------------------
    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir,
      fs: fakeFs,
    });

    assert.equal(candidates.length, 1);
    const candidate = candidates[0];
    assert.equal(candidate.title, "Hytale");
    assert.equal(candidate.source, "hytale");
    assert.equal(candidate.platform, "windows");
    assert.equal(candidate.isGameHint, true);
    assert.equal(candidate.executablePath, clientExecutable);
    assert.deepEqual(candidate.savePaths, [savesDir, settingsFile]);
    assert.match(candidate.id, /^hytale-[0-9a-f]{16}$/);

    // -- stage 2: IMPORT ----------------------------------------------------
    // The real context builder for the imported game — the same function the
    // add-custom-game event calls with the game's path context.
    const objectId = "hytale-windows-object-id";
    const context: CloudSaveCustomPathContext =
      cloudSaveCustomPathContextFromPathContext({
        platform: "windows",
        homeDir,
        documentsDir: win(homeDir, "Documents"),
        appDataDir: appData,
        executablePath: candidate.executablePath ?? undefined,
        winePrefixPath: undefined,
        steamPath: undefined,
        objectId,
        storeUserContext: { known: [] },
      });
    assert.equal(context.platform, "windows");

    const store = createFakeStore();
    const registered = await registerSavePathsForCustomGame(
      "custom",
      objectId,
      candidate.savePaths,
      {
        getCustomPathContext: async () => context,
        // The Windows layout lives in the in-memory fake fs, so the
        // existence probe reports what the DETECT stage just proved.
        statPath: async (absolutePath) =>
          candidate.savePaths.includes(absolutePath)
            ? absolutePath.endsWith(".json")
              ? "file"
              : "dir"
            : null,
        // The fs shell of canonicalizeSelectedCloudSaveCustomPath (stat +
        // realpath + symlink-ancestor guard) cannot run against a fake
        // Windows fs on this box; chain the pure canonicalization core the
        // real shell delegates to, and thread the probed kind through —
        // exactly what the real shell returns.
        canonicalize: async (selectedPath, canonicalContext, kind) => ({
          ...encodeCloudSaveCustomPath(selectedPath, canonicalContext),
          kind,
        }),
        registerCloudSaveCustomPaths: store.register,
        warn: (message) => {
          throw new Error(`unexpected import warning: ${message}`);
        },
      }
    );

    // The store received both paths, canonicalized + encoded, as a single
    // "pending" registration — the documented syncState until the first
    // sync pushes them.
    assert.equal(registered.length, 2);
    assert.equal(store.calls.length, 1);
    const [storeCall] = store.calls;
    assert.equal(storeCall.shop, "custom");
    assert.equal(storeCall.objectId, objectId);
    assert.equal(storeCall.options?.syncState, "pending");
    assert.deepEqual(
      storeCall.customPaths.map((entry) => entry.rawPath),
      [
        "<custom><windows><winAppData>/Hytale/UserData/Saves",
        "<custom><windows><winAppData>/Hytale/Settings.json",
      ]
    );
    assert.deepEqual(
      storeCall.customPaths.map((entry) => entry.kind),
      ["dir", "file"]
    );

    // -- stage 3: ROUNDTRIP -------------------------------------------------
    // What the Drive snapshot round-trips must decode back to the exact
    // absolute paths the detector produced (in the canonicalizer's
    // normalized forward-slash form for the matching OS segment).
    const originalPaths = candidate.savePaths.map((savePath) =>
      savePath.replaceAll("\\", "/")
    );
    for (const [index, entry] of storeCall.customPaths.entries()) {
      const decoded = decodeCloudSaveCustomPath(entry.rawPath, context);
      assert.equal(decoded.platform, "windows");
      assert.equal(decoded.path, originalPaths[index]);
      assert.equal(decoded.rawPath, entry.rawPath);
    }

    // -- stage 4: ELIGIBILITY ----------------------------------------------
    assert.equal(isCloudSaveV2Eligible("custom"), true);

    // The pure predicate chain of canRunAutomaticCloudSaveSync
    // (automatic-sync.ts l.58-75), driven with the imported game record.
    // Links skipped (documented): isGoogleDriveCloudLinked (Drive token
    // store → LevelDB), isCloudSaveDeletionPending (LevelDB sublevel) and
    // gamesSublevel.get (LevelDB) — this scenario substitutes the record.
    const importedGame: {
      shop: GameShop;
      platform: string;
      executablePath: string | null;
      automaticCloudSync: boolean;
    } = {
      shop: "custom",
      platform: "windows",
      executablePath: candidate.executablePath,
      automaticCloudSync: true,
    };

    const runEligibilityChain = (
      game: typeof importedGame,
      storedV2Enabled: boolean | undefined
    ) => {
      const legacyEnabled = game.automaticCloudSync === true;
      const mode = resolveStoredCloudSaveAutomaticSyncMode(
        legacyEnabled,
        storedV2Enabled
      );
      return {
        mode,
        enabled: shouldRunV2AutomaticCloudSave(mode),
        executable: Boolean(game.executablePath),
        v2Eligible: isCloudSaveV2Eligible(game.shop, game.platform),
      };
    };

    // The import wizard ships with automatic sync checked by default:
    // legacy flag true, no stored v2 flag yet → resolves to v2.
    assert.deepEqual(runEligibilityChain(importedGame, undefined), {
      mode: "v2",
      enabled: true,
      executable: true,
      v2Eligible: true,
    });

    // Opting out later (setCloudSaveAutomaticSyncEnabled(false) persists a
    // stored v2 flag of false) must win over the legacy flag.
    assert.deepEqual(runEligibilityChain(importedGame, false), {
      mode: "disabled",
      enabled: false,
      executable: true,
      v2Eligible: true,
    });

    // A game record created with automaticCloudSync off (the main-process
    // default for fresh custom games) stays disabled.
    assert.deepEqual(
      runEligibilityChain(
        { ...importedGame, automaticCloudSync: false },
        undefined
      ),
      { mode: "disabled", enabled: false, executable: true, v2Eligible: true }
    );

    // The executable link: no executable, no automatic sync.
    assert.equal(
      runEligibilityChain({ ...importedGame, executablePath: null }, undefined)
        .executable,
      false
    );
  });

  it("scenario 2: Linux flatpak + native detection → real import → decode roundtrip", async (t) => {
    // Everything here is real: an on-disk temp home, the real node fs (the
    // same adapter scanHytaleCandidates wires in production) and the full
    // canonicalizeSelectedCloudSaveCustomPath shell.
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "chain-a-"));
    t.after(() => fsp.rm(tempRoot, { recursive: true, force: true }));
    const homeDir = fs.realpathSync(
      await fsp.mkdtemp(path.join(tempRoot, "home-"))
    );

    const flatpakRoot = posix(
      homeDir,
      ".var",
      "app",
      "com.hypixel.HytaleLauncher",
      "data",
      "Hytale"
    );
    const flatpakSaves = posix(flatpakRoot, "UserData", "Saves");
    const flatpakSettings = posix(flatpakRoot, "Settings.json");
    const flatpakExportsBin = posix(
      homeDir,
      ".local",
      "share",
      "flatpak",
      "exports",
      "bin",
      "com.hypixel.HytaleLauncher"
    );

    await fsp.mkdir(posix(flatpakSaves, "FlatWorld"), { recursive: true });
    await fsp.writeFile(posix(flatpakSaves, "FlatWorld", "preview.png"), "png");
    await fsp.writeFile(flatpakSettings, '{"patchline":"release"}');
    await fsp.writeFile(posix(flatpakRoot, "hytale-launcher.log"), "log line");
    await fsp.mkdir(path.dirname(flatpakExportsBin), { recursive: true });
    await fsp.writeFile(flatpakExportsBin, "#!/bin/sh\n", { mode: 0o755 });

    // A second, native $XDG_DATA_HOME install (portable zip → the binary
    // lives wherever the user unpacked it, so no executable is detectable).
    const xdgDataHome = await fsp.mkdtemp(path.join(tempRoot, "xdg-"));
    const nativeRoot = posix(xdgDataHome, "Hytale");
    const nativeSaves = posix(nativeRoot, "UserData", "Saves");
    const nativeSettings = posix(nativeRoot, "Settings.json");
    await fsp.mkdir(posix(nativeSaves, "NativeWorld"), {
      recursive: true,
    });
    await fsp.writeFile(
      posix(nativeSaves, "NativeWorld", "preview.png"),
      "png"
    );
    await fsp.writeFile(nativeSettings, "{}");

    // -- stage 1/5: DETECT (Linux) ------------------------------------------
    const candidates = await buildHytaleCandidates({
      platform: "linux",
      env: { XDG_DATA_HOME: xdgDataHome },
      homeDir,
      fs: createRealFilesystem(),
    });

    assert.equal(candidates.length, 2);
    const [flatpak, native] = candidates;
    assert.equal(flatpak.title, "Hytale (Flatpak)");
    assert.equal(flatpak.platform, "linux");
    assert.equal(flatpak.executablePath, flatpakExportsBin);
    assert.deepEqual(flatpak.savePaths, [flatpakSaves, flatpakSettings]);
    assert.equal(native.title, "Hytale");
    assert.equal(native.executablePath, null);
    assert.deepEqual(native.savePaths, [nativeSaves, nativeSettings]);

    // -- stage 2: IMPORT (the full real canonicalize shell) -----------------
    const objectId = "hytale-flatpak-object-id";
    const context: CloudSaveCustomPathContext =
      cloudSaveCustomPathContextFromPathContext({
        platform: "linux",
        homeDir,
        executablePath: flatpak.executablePath ?? undefined,
        winePrefixPath: undefined,
        steamPath: undefined,
        objectId,
        storeUserContext: { known: [] },
      });

    const store = createFakeStore();
    const registered = await registerSavePathsForCustomGame(
      "custom",
      objectId,
      flatpak.savePaths,
      {
        getCustomPathContext: async () => context,
        statPath: async (absolutePath) => {
          const stats = await fsp.stat(absolutePath);
          return stats.isDirectory() ? "dir" : stats.isFile() ? "file" : null;
        },
        canonicalize: canonicalizeSelectedCloudSaveCustomPath,
        registerCloudSaveCustomPaths: store.register,
        warn: (message) => {
          throw new Error(`unexpected import warning: ${message}`);
        },
      }
    );

    assert.equal(registered.length, 2);
    assert.equal(store.calls.length, 1);
    const [storeCall] = store.calls;
    assert.equal(storeCall.options?.syncState, "pending");
    assert.deepEqual(
      storeCall.customPaths.map((entry) => entry.rawPath),
      [
        `<custom><linux><home>${flatpakSaves.slice(homeDir.length)}`,
        `<custom><linux><home>${flatpakSettings.slice(homeDir.length)}`,
      ]
    );
    assert.deepEqual(
      storeCall.customPaths.map((entry) => entry.kind),
      ["dir", "file"]
    );

    // -- stage 3: ROUNDTRIP (real decode → byte-exact absolute paths) --------
    for (const [index, entry] of storeCall.customPaths.entries()) {
      const decoded = decodeCloudSaveCustomPath(entry.rawPath, context);
      assert.equal(decoded.platform, "linux");
      assert.equal(decoded.path, flatpak.savePaths[index]);
    }

    // -- stage 4: ELIGIBILITY (the linux leg of the same predicate chain) ---
    assert.equal(isCloudSaveV2Eligible("custom", "linux"), true);
    assert.equal(
      shouldRunV2AutomaticCloudSave(
        resolveStoredCloudSaveAutomaticSyncMode(true, undefined)
      ),
      true
    );
  });

  it("scenario 3: scan orchestrator dedupes, orders, and keeps the saves-detected candidate", async () => {
    const homeDir = "/home/tester";
    const applicationsDir = "/usr/share/applications";
    const flatpakRoot = posix(
      homeDir,
      ".var",
      "app",
      "com.hypixel.HytaleLauncher",
      "data",
      "Hytale"
    );
    const flatpakSaves = posix(flatpakRoot, "UserData", "Saves");
    const flatpakSettings = posix(flatpakRoot, "Settings.json");
    const flatpakExportsBin = posix(
      homeDir,
      ".local",
      "share",
      "flatpak",
      "exports",
      "bin",
      "com.hypixel.HytaleLauncher"
    );

    const desktopEntry = (body: Record<string, string>): string =>
      [
        "[Desktop Entry]",
        "Type=Application",
        ...Object.entries(body).map(([key, value]) => `${key}=${value}`),
      ].join("\n");

    const fakeFs = createFakeFilesystem({
      directories: [
        "/opt/games",
        applicationsDir,
        homeDir,
        flatpakRoot,
        posix(flatpakRoot, "UserData"),
        flatpakSaves,
        posix(flatpakSaves, "EmeraldWorld"),
      ],
      files: {
        // The hytale layout: saves matrix + flatpak export binary.
        [posix(flatpakSaves, "EmeraldWorld", "preview.png")]: "png",
        [flatpakSettings]: '{"patchline":"release"}',
        [posix(flatpakRoot, "hytale-launcher.log")]: "log",
        [flatpakExportsBin]: "#!/bin/sh",
        // One desktop entry per profile the scanner must handle.
        [posix(applicationsDir, "alpha-quest.desktop")]: desktopEntry({
          Name: "Alpha Quest",
          Exec: "/opt/games/alpha-quest",
          Icon: "/opt/games/icons/alpha.png",
          Categories: "Game;AdventureGame;",
        }),
        [posix(applicationsDir, "aaa-setup.desktop")]: desktopEntry({
          Name: "AAA Setup",
          Exec: "/opt/games/aaa-setup",
        }),
        [posix(applicationsDir, "beta-utility.desktop")]: desktopEntry({
          Name: "Beta Utility",
          Exec: "/opt/games/beta-utility",
        }),
        // Already imported into the library by the user earlier.
        [posix(applicationsDir, "playgame.desktop")]: desktopEntry({
          Name: "Playgame",
          Exec: "/opt/games/playgame",
        }),
        // The Hytale flatpak's own desktop entry — the hytale module owns
        // that candidate; the desktop scanner must never emit a second.
        [posix(applicationsDir, "hytale-launcher.desktop")]: desktopEntry({
          Name: "Hytale Launcher",
          Exec: "flatpak run com.hypixel.HytaleLauncher",
          Categories: "Game;",
        }),
        ["/opt/games/alpha-quest"]: "#!/bin/sh",
        ["/opt/games/aaa-setup"]: "#!/bin/sh",
        ["/opt/games/beta-utility"]: "#!/bin/sh",
        ["/opt/games/playgame"]: "#!/bin/sh",
      },
    });

    // One existing library game duplicating the "Playgame" candidate —
    // by executable key and by custom-game title at once.
    const library: Game[] = [
      makeLibraryGame({
        title: "Playgame",
        shop: "custom",
        objectId: "playgame-object-id",
        executablePath: "/opt/games/playgame",
      }),
    ];

    // -- stage 6: SCAN-ORCHESTRATOR -----------------------------------------
    const candidates = await scanExternalGames({
      platform: "linux",
      getLibraryGames: async () => library,
      scanHytale: () =>
        buildHytaleCandidates({
          platform: "linux",
          env: {},
          homeDir,
          fs: fakeFs,
        }),
      scanDesktopEntries: async () =>
        buildDesktopEntryCandidates({ homeDir, fs: fakeFs }),
      // Real wiring on Linux: the Windows registry scanner no-ops outside
      // win32 — asserted here as part of the platform matrix.
      scanUninstallEntries: scanWindowsUninstallEntries,
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.title),
      ["Hytale (Flatpak)", "Alpha Quest", "AAA Setup", "Beta Utility"]
    );

    // The hytale candidate survives with its full save matrix ("saves
    // detected") — exactly the data the import wizard's chip renders.
    const [hytale] = candidates;
    assert.equal(hytale.source, "hytale");
    assert.equal(hytale.executablePath, flatpakExportsBin);
    assert.deepEqual(hytale.savePaths, [flatpakSaves, flatpakSettings]);

    // Ordering: hytale first, then the Game-category hint, then A–Z for
    // the rest.
    const [alphaQuest] = candidates.filter(
      (candidate) => candidate.title === "Alpha Quest"
    );
    assert.equal(alphaQuest.isGameHint, true);
    assert.equal(alphaQuest.iconPath, "/opt/games/icons/alpha.png");
    for (const candidate of candidates.slice(2)) {
      assert.equal(candidate.isGameHint, false);
    }

    // Dedupe: the library duplicate is gone, and no second hytale leaked
    // through the desktop-entry scanner.
    assert.ok(!candidates.some((candidate) => candidate.title === "Playgame"));
    assert.ok(
      !candidates.some((candidate) => candidate.title === "Hytale Launcher")
    );
  });
});
