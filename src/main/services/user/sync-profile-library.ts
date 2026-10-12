import { HydraApi, logger } from "../";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "../window-manager";
import type { Game, GameShop, ShopAssets } from "@types";

const PAGE_SIZE = 100;

/**
 * The sign-in catalogue pull the user actually cares about: the account's
 * game library comes down so a fresh install shows the same games the user
 * already had on Hydra (downloadable right away). Kept intentionally
 * minimal — no social fields, no artwork reconciliation:
 *
 *  - missing games are created (shop/objectId/title/art/playtime)
 *  - existing games only gain the remoteId + missing artwork/playtime
 *    (local state always wins — deleted stays deleted, playtime untouched)
 *  - the per-game shop assets (cover + downloadSources) are refreshed
 */
interface ProfileGame {
  id?: string;
  objectId?: string;
  shop?: string;
  title?: string;
  iconUrl?: string | null;
  libraryImageUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  logoImageUrl?: string | null;
  downloadSources?: string[] | null;
  playTimeInMilliseconds?: number | null;
  playTimeInSeconds?: number | null;
  lastTimePlayed?: string | null;
  createdAt?: string | null;
  favorite?: boolean;
  isPinned?: boolean;
}

const KNOWN_SHOPS = new Set<string>(["steam", "custom", "launchbox"]);

const toMilliseconds = (remote: ProfileGame): number => {
  if (typeof remote.playTimeInMilliseconds === "number") {
    return remote.playTimeInMilliseconds;
  }
  if (typeof remote.playTimeInSeconds === "number") {
    return remote.playTimeInSeconds * 1000;
  }
  return 0;
};

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const mergePage = async (page: ProfileGame[]): Promise<number> => {
  let created = 0;

  for (const remote of page) {
    if (!remote?.objectId || !remote.shop) continue;
    if (!KNOWN_SHOPS.has(remote.shop)) continue;

    const shop = remote.shop as GameShop;
    const gameKey = levelKeys.game(shop, remote.objectId);

    try {
      const local = await gamesSublevel.get(gameKey);

      // Local library always wins: deleted stays deleted, and existing
      // games only gain what they are missing (remoteId/art/playtime).
      if (local && local.isDeleted) continue;

      if (!local) {
        const game: Game = {
          title: remote.title || remote.objectId,
          iconUrl: remote.iconUrl ?? null,
          libraryHeroImageUrl: remote.libraryHeroImageUrl ?? null,
          logoImageUrl: remote.logoImageUrl ?? null,
          objectId: remote.objectId,
          shop,
          remoteId: remote.id ?? null,
          isDeleted: false,
          playTimeInMilliseconds: toMilliseconds(remote),
          lastTimePlayed: parseDate(remote.lastTimePlayed),
          addedToLibraryAt: parseDate(remote.createdAt) ?? new Date(),
          source: "hydra",
          favorite: remote.favorite ?? false,
          isPinned: remote.isPinned ?? false,
          launchOptions: null,
        };

        await gamesSublevel.put(gameKey, game);
        created += 1;
      } else if (!local.remoteId && remote.id) {
        await gamesSublevel.put(gameKey, {
          ...local,
          remoteId: remote.id,
        });
      }

      const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
      const remoteSources = Array.isArray(remote.downloadSources)
        ? remote.downloadSources
        : [];
      const assets = {
        updatedAt: Date.now(),
        shop,
        objectId: remote.objectId,
        title: remote.title || existingAssets?.title || remote.objectId,
        iconUrl: remote.iconUrl ?? existingAssets?.iconUrl ?? null,
        coverImageUrl:
          remote.libraryImageUrl ?? existingAssets?.coverImageUrl ?? "",
        libraryImageUrl:
          remote.libraryImageUrl ?? existingAssets?.libraryImageUrl ?? "",
        libraryHeroImageUrl:
          remote.libraryHeroImageUrl ??
          existingAssets?.libraryHeroImageUrl ??
          "",
        logoImageUrl: remote.logoImageUrl ?? existingAssets?.logoImageUrl ?? "",
        logoPosition: existingAssets?.logoPosition ?? null,
        downloadSources:
          remoteSources.length > 0
            ? remoteSources
            : (existingAssets?.downloadSources ?? []),
      } as ShopAssets & { updatedAt: number };

      await gamesShopAssetsSublevel.put(gameKey, assets);
    } catch (error) {
      logger.warn("Failed to merge profile game into the library", {
        objectId: remote.objectId,
        error,
      });
    }
  }

  return created;
};

/**
 * Pulls the signed-in account's game library into the local one. Called
 * right after sign-in and once per boot for signed-in users; the whole
 * flow is best-effort and never throws.
 */
export const syncProfileLibraryFromApi = async (): Promise<void> => {
  if (!HydraApi.isLoggedIn()) return;

  try {
    let created = 0;
    let total = 0;

    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await HydraApi.get<ProfileGame[]>(
        "/profile/games",
        { take: PAGE_SIZE, skip },
        { needsAuth: true }
      );

      if (!Array.isArray(page) || page.length === 0) break;

      total += page.length;
      created += await mergePage(page);

      if (page.length < PAGE_SIZE) break;
    }

    if (total > 0) {
      logger.log(
        `Profile library synced: ${total} remote game(s), ${created} added locally`
      );
      WindowManager.sendToAppWindows("on-library-batch-complete");
    }
  } catch (error) {
    logger.warn("Failed to sync the profile library from the account", error);
  }
};
