import { downloadsSublevel } from "./level/sublevels/downloads";
import { orderBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import { refreshGlobalTrackersUrlCache } from "@main/helpers";
import { type Download, type UserPreferences } from "../types";
import path from "node:path";
import fs from "node:fs";
import {
  SystemPath,
  CommonRedistManager,
  TorBoxClient,
  RealDebridClient,
  PremiumizeClient,
  AllDebridClient,
  DownloadManager,
  HydraApi,
  startMainLoop,
  Ludusavi,
  Lock,
  DownloadSourcesChecker,
  DownloadOrchestrator,
  Wine,
  WindowManager,
  logger,
  migrateCloudSaveAutomaticSyncDefaults,
} from "@main/services";
import { migrateDownloadSources } from "./helpers/migrate-download-sources";
import { getDirSize } from "./services/download/helpers";
import { GofileApi } from "./services/hosters";
import { watchSteamLibraries } from "./services/steam-integration/steam-install-watcher";
import { seedDefaultDownloadSources } from "./helpers/seed-default-download-sources";
import { defaultDownloadsPath } from "@main/constants";

const hasMissingSeedFiles = async (download: Download): Promise<boolean> => {
  if (!download.folderName) return false;

  const downloadTargetPath = path.join(
    download.downloadPath,
    download.folderName
  );

  if (!fs.existsSync(downloadTargetPath)) {
    return true;
  }

  const expectedSize = download.selectedFilesSize ?? download.fileSize ?? 0;

  if (expectedSize <= 0) {
    return false;
  }

  const currentSize = await getDirSize(downloadTargetPath);
  return currentSize < expectedSize;
};

export const loadState = async () => {
  await Lock.acquireLock();
  await migrateCloudSaveAutomaticSyncDefaults();

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  Wine.syncUserPreferences(userPreferences);

  // Ensure the default games library directory exists so fresh installs
  // have a clean, dedicated place to install games (~/Games/Hydra).
  if (!userPreferences?.downloadsPath) {
    await fs.promises
      .mkdir(defaultDownloadsPath, { recursive: true })
      .catch(() => undefined);
  }

  await import("./events");

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences.realDebridApiToken);
  }

  if (userPreferences?.premiumizeApiToken) {
    PremiumizeClient.authorize(userPreferences.premiumizeApiToken);
  }

  if (userPreferences?.allDebridApiToken) {
    AllDebridClient.authorize(userPreferences.allDebridApiToken);
  }

  if (userPreferences?.torBoxApiToken) {
    TorBoxClient.authorize(userPreferences.torBoxApiToken);
  }

  GofileApi.initialize();

  if (
    userPreferences?.appendGlobalTrackersUrl &&
    userPreferences?.globalTrackersUrl
  ) {
    refreshGlobalTrackersUrlCache().catch((err) =>
      logger.warn("Failed to refresh global tracker URL cache on startup", err)
    );
  }

  Ludusavi.copyConfigFileToUserData();
  Ludusavi.copyBinaryToUserData();

  void watchSteamLibraries();

  // Anonymous public API client (catalogue/download sources); no auth.
  await HydraApi.setupApi();

  void migrateDownloadSources();

  // First-run: curated download sources so search works out of the box.
  void seedDefaultDownloadSources();

  // Check for new download options on startup (if enabled)
  void DownloadSourcesChecker.checkForChanges();

  const downloadToResume =
    await DownloadOrchestrator.bootstrapDownloadsOnStartup();
  const normalizedDownloads = await downloadsSublevel
    .values()
    .all()
    .then((games) => orderBy(games, "timestamp", "desc"));

  const downloadsToSeed: Download[] = [];

  for (const game of normalizedDownloads) {
    if (
      !game.shouldSeed ||
      game.downloader !== Downloader.Torrent ||
      game.progress !== 1 ||
      game.status !== "seeding" ||
      game.uri === null
    ) {
      continue;
    }

    if (!(await hasMissingSeedFiles(game))) {
      downloadsToSeed.push(game);
      continue;
    }

    const gameKey = levelKeys.game(game.shop, game.objectId);
    const expectedSize = game.selectedFilesSize ?? game.fileSize ?? 0;
    let progress = game.progress;

    if (game.folderName) {
      const downloadTargetPath = path.join(game.downloadPath, game.folderName);
      const currentSize = fs.existsSync(downloadTargetPath)
        ? await getDirSize(downloadTargetPath)
        : 0;
      progress =
        expectedSize > 0
          ? Math.min(currentSize / expectedSize, 1)
          : game.progress;
    }

    await downloadsSublevel.put(gameKey, {
      ...game,
      status: "paused",
      shouldSeed: false,
      queued: false,
      pinnedToHero: false,
      progress,
    });

    logger.warn(
      `[Startup] Seed files missing for ${gameKey}; seeding was disabled`
    );
  }

  // Torrents use the native service; HTTP downloads use the JS downloader.
  const isTorrent = downloadToResume?.downloader === Downloader.Torrent;
  if (downloadToResume && !isTorrent) {
    // Initialize torrent seeding, then resume the HTTP download with JS.
    await DownloadManager.initializeTorrentService(undefined, downloadsToSeed);
    await DownloadManager.startDownload(downloadToResume).catch((err) => {
      // If resume fails, just log it - user can manually retry
      logger.error("Failed to auto-resume download:", err);
    });
  } else {
    await DownloadManager.initializeTorrentService(
      downloadToResume ?? undefined,
      downloadsToSeed
    );
  }

  WindowManager.sendDownloadsUpdated();

  startMainLoop();

  if (process.platform === "win32") {
    // Fire-and-forget, but never let a network hiccup become an unhandled
    // rejection on every startup.
    CommonRedistManager.downloadCommonRedist().catch((error) =>
      logger.warn("Common redist download failed", error)
    );
  }

  SystemPath.checkIfPathsAreAvailable();
};
