import type { GameShop } from "@types";

/**
 * Cloud Save v2 (content-addressed snapshots, three-way merge) eligibility.
 * v2 covers Steam games; "custom" games keep using the legacy Hydra Cloud
 * artifact flow, and "launchbox" (retro emulation) was removed from the fork.
 */
export const isCloudSaveV2Eligible = (
  shop: GameShop,
  _platform?: string | null
) => shop === "steam";

export const hasCloudSaveExecutableSelection = (game: {
  shop: GameShop;
  executablePath?: string | null;
}) => Boolean(game.executablePath);
