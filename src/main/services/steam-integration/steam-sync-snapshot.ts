import type {
  SteamSourceLibraryGame,
  SteamSnapshotChunkPayload,
  SteamSnapshotGame,
  SteamSnapshotPayload,
} from "@types";

const SNAPSHOT_GAME_CHUNK_SIZE = 2_000;

export const buildSteamSnapshot = (
  games: SteamSourceLibraryGame[]
): SteamSnapshotPayload => ({
  games: games.map((game) => ({
    steamAppId: String(game.steamAppId),
    name: game.name,
    playTimeInSeconds: game.playTimeInSeconds,
    lastPlayedAt: game.lastPlayedAt,
  })),
});

export const chunkSteamSnapshot = (
  snapshot: SteamSnapshotPayload
): SteamSnapshotChunkPayload[] => {
  const gameChunks: SteamSnapshotGame[][] = [];

  for (
    let index = 0;
    index < snapshot.games.length;
    index += SNAPSHOT_GAME_CHUNK_SIZE
  ) {
    gameChunks.push(
      snapshot.games.slice(index, index + SNAPSHOT_GAME_CHUNK_SIZE)
    );
  }

  if (gameChunks.length === 0) gameChunks.push([]);

  const totalChunks = gameChunks.length;
  return gameChunks.map((games) => ({ totalChunks, games }));
};

export const uploadSteamSnapshotChunks = async (
  chunks: SteamSnapshotChunkPayload[],
  stage: (
    chunk: SteamSnapshotChunkPayload,
    chunkIndex: number
  ) => Promise<void>,
  commit: () => Promise<void>
) => {
  for (const [chunkIndex, chunk] of chunks.entries()) {
    await stage(chunk, chunkIndex);
  }
  await commit();
};
