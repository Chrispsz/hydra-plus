import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { createGameRecordUpdater } from "./game-record-updater-core.js";

const game: Game = {
  title: "Portal 2",
  iconUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  playTimeInMilliseconds: 600_000,
  unsyncedDeltaPlayTimeInMilliseconds: 120_000,
  lastTimePlayed: null,
  objectId: "620",
  shop: "steam",
  remoteId: "remote-id",
  isDeleted: false,
};

describe("game record updater", () => {
  it("preserves playtime and pending deltas across concurrent setting updates", async () => {
    let storedGame = { ...game };
    const updateGame = createGameRecordUpdater({
      get: async () => ({ ...storedGame }),
      put: async (_key, value) => {
        await Promise.resolve();
        storedGame = { ...value };
      },
    });

    await Promise.all([
      updateGame("steam:620", {
        playTimeInMilliseconds: 660_000,
        unsyncedDeltaPlayTimeInMilliseconds: 180_000,
      }),
      updateGame("steam:620", { enableHydraPlaytimeTracking: true }),
    ]);

    assert.equal(storedGame.playTimeInMilliseconds, 660_000);
    assert.equal(storedGame.unsyncedDeltaPlayTimeInMilliseconds, 180_000);
    assert.equal(storedGame.enableHydraPlaytimeTracking, true);
  });

  it("keeps process updates made while an async merge waits for external data", async () => {
    let storedGame = { ...game };
    const updateGame = createGameRecordUpdater({
      get: async () => ({ ...storedGame }),
      put: async (_key, value) => {
        storedGame = { ...value };
      },
    });
    let finishRemoteFetch!: (steamPlayTimeInMilliseconds: number) => void;
    const remoteFetch = new Promise<number>((resolve) => {
      finishRemoteFetch = resolve;
    });
    const externalMerge = (async () => {
      const steamPlayTimeInSeconds = await remoteFetch;
      await updateGame("steam:620", (currentGame) => ({
        ...currentGame,
        steamPlayTimeInMilliseconds: steamPlayTimeInSeconds * 1_000,
        hasActiveSteamImport: true,
      }));
    })();

    await updateGame("steam:620", {
      playTimeInMilliseconds: 780_000,
      unsyncedDeltaPlayTimeInMilliseconds: 180_000,
      executablePath: "/games/Portal 2/portal2",
      enableHydraPlaytimeTracking: true,
    });
    finishRemoteFetch(3_600);
    await externalMerge;

    assert.equal(storedGame.playTimeInMilliseconds, 780_000);
    assert.equal(storedGame.unsyncedDeltaPlayTimeInMilliseconds, 180_000);
    assert.equal(storedGame.executablePath, "/games/Portal 2/portal2");
    assert.equal(storedGame.enableHydraPlaytimeTracking, true);
    assert.equal(storedGame.steamPlayTimeInMilliseconds, 3_600_000);
    assert.equal(storedGame.hasActiveSteamImport, true);
  });

  it("keeps process state across a concurrent favorite update", async () => {
    let storedGame = { ...game };
    const updateGame = createGameRecordUpdater({
      get: async () => ({ ...storedGame }),
      put: async (_key, value) => {
        await Promise.resolve();
        storedGame = { ...value };
      },
    });

    await Promise.all([
      updateGame("steam:620", {
        playTimeInMilliseconds: 720_000,
        unsyncedDeltaPlayTimeInMilliseconds: 240_000,
        executablePath: "/games/Portal 2/portal2",
      }),
      updateGame("steam:620", (currentGame) => ({
        favorite: !currentGame.favorite,
        isPinned: true,
      })),
    ]);

    assert.equal(storedGame.playTimeInMilliseconds, 720_000);
    assert.equal(storedGame.unsyncedDeltaPlayTimeInMilliseconds, 240_000);
    assert.equal(storedGame.executablePath, "/games/Portal 2/portal2");
    assert.equal(storedGame.favorite, true);
    assert.equal(storedGame.isPinned, true);
  });
});
