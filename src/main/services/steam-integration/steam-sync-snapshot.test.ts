import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamSourceLibraryGame } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildSteamSnapshot,
  chunkSteamSnapshot,
  uploadSteamSnapshotChunks,
} from "./steam-sync-snapshot.ts";

const libraryGame = (
  steamAppId: string,
  playTimeInSeconds = 600
): SteamSourceLibraryGame => ({
  steamAppId,
  name: `Game ${steamAppId}`,
  playTimeInSeconds,
  lastPlayedAt: "2026-09-17T18:00:00.000Z",
});

describe("buildSteamSnapshot", () => {
  it("copies playtime and lastPlayedAt from the library", () => {
    const snapshot = buildSteamSnapshot([libraryGame("620", 3_600)]);

    assert.deepEqual(snapshot.games, [
      {
        steamAppId: "620",
        name: "Game 620",
        playTimeInSeconds: 3_600,
        lastPlayedAt: "2026-09-17T18:00:00.000Z",
      },
    ]);
  });

  it("stringifies numeric app ids", () => {
    const snapshot = buildSteamSnapshot([
      libraryGame("620"),
      libraryGame("220"),
    ]);

    assert.deepEqual(
      snapshot.games.map((game) => game.steamAppId),
      ["620", "220"]
    );
  });
});

describe("chunkSteamSnapshot", () => {
  it("keeps small libraries in a single chunk", () => {
    const snapshot = buildSteamSnapshot([
      libraryGame("620"),
      libraryGame("220"),
    ]);

    const chunks = chunkSteamSnapshot(snapshot);

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].totalChunks, 1);
    assert.equal(chunks[0].games.length, 2);
  });

  it("splits large libraries deterministically", () => {
    const games = Array.from({ length: 2_501 }, (_, index) =>
      libraryGame(String(index + 1))
    );

    const chunks = chunkSteamSnapshot(buildSteamSnapshot(games));

    assert.equal(chunks.length, 2);
    assert.deepEqual(
      chunks.map((chunk) => chunk.games.length),
      [2_000, 501]
    );
    assert.equal(chunks[0].totalChunks, 2);
    assert.equal(chunks[1].totalChunks, 2);
  });

  it("emits one empty chunk for an empty library", () => {
    const chunks = chunkSteamSnapshot(buildSteamSnapshot([]));

    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0].games, []);
    assert.equal(chunks[0].totalChunks, 1);
  });
});

describe("uploadSteamSnapshotChunks", () => {
  it("stages every chunk in order and commits once", async () => {
    const staged: number[] = [];
    let commits = 0;

    await uploadSteamSnapshotChunks(
      [
        { totalChunks: 2, games: [] },
        { totalChunks: 2, games: [] },
      ],
      async (_chunk, chunkIndex) => {
        staged.push(chunkIndex);
      },
      async () => {
        commits += 1;
      }
    );

    assert.deepEqual(staged, [0, 1]);
    assert.equal(commits, 1);
  });
});
