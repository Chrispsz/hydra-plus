import type { GameShop } from "@types";

/**
 * Cloud Save v2 (content-addressed snapshots, three-way merge) eligibility.
 * Hydra Plus is Drive-only, so the Drive engine covers every shop: Steam
 * games and "custom" manually imported games alike. "launchbox" (retro
 * emulation) was removed from the fork.
 */
const CLOUD_SAVE_V2_SHOPS: GameShop[] = ["steam", "custom"];

export const isCloudSaveV2Eligible = (
  shop: GameShop,
  _platform?: string | null
) => CLOUD_SAVE_V2_SHOPS.includes(shop);

export const hasCloudSaveExecutableSelection = (game: {
  shop: GameShop;
  executablePath?: string | null;
}) => Boolean(game.executablePath);
