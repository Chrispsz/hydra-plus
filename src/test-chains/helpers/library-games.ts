/**
 * Minimal library `Game` records for the scan-orchestrator stage of the
 * external-games chain. Only the fields the orchestrator consumes
 * (`executablePath`, `shop`, `title`) vary; everything else is inert filler.
 */
import type { Game, GameShop } from "@types";

export const makeLibraryGame = (overrides: {
  title: string;
  shop: GameShop;
  objectId: string;
  executablePath?: string | null;
}): Game =>
  ({
    title: overrides.title,
    iconUrl: null,
    libraryHeroImageUrl: null,
    logoImageUrl: null,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    objectId: overrides.objectId,
    shop: overrides.shop,
    remoteId: null,
    isDeleted: false,
    executablePath: overrides.executablePath ?? null,
  }) as Game;
