// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";
import { randomUUID } from "node:crypto";

import type {
  GameShop,
  DownloadProgress,
  UserPreferences,
  AppUpdaterEvent,
  StartGameDownloadPayload,
  GameRunning,
  SeedingStatus,
  ArtworkAssetType,
  ShortcutLocation,
  CreateSteamShortcutOptions,
  ProtonVersion,
  ProtonProvider,
  ProtonRelease,
  ProtonInstallTarget,
  ProtonInstallProgress,
  TorrentFilesResponse,
  DownloadLayoutState,
  CloudSaveAutomaticSyncModeChangedEvent,
  CloudSaveAutomaticSyncEvent,
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveV2FileDetails,
  CloudSaveSyncIpcProgressPayload,
  CloudSaveSyncProgressPayload,
  SyncCloudSaveOnGamePageResult,
  SyncGameCloudSaveResult,
  SelectCloudSaveCustomPathResult,
  CloudSaveCustomPathApproval,
  CloudSaveModalSyncResult,
  SnapshotVersionSummary,
  RestoreRemoteSnapshotResult,
  DiscoveredSaveLocation,
  PortableReleaseInfo,
  DriveHygieneOverview,
  DriveCleanupResult,
  SelectCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathRebindApprovalResult,
  ExtractionFailure,
} from "@types";

const invokeCloudSaveOperation = async <TResult = SyncGameCloudSaveResult>(
  channel:
    | "syncGameCloudSave"
    | "syncGameCloudSaveFromModal"
    | "syncCloudSaveAfterCustomPathRebind"
    | "resolveCloudSaveConflict",
  args: unknown[],
  onProgress?: (progress: CloudSaveSyncProgressPayload) => void
) => {
  const operationId = randomUUID();
  const listener = (
    _event: Electron.IpcRendererEvent,
    progress: CloudSaveSyncIpcProgressPayload
  ) => {
    if (progress.operationId === operationId) onProgress?.(progress);
  };
  ipcRenderer.on("on-cloud-save-sync-progress", listener);
  try {
    return (await ipcRenderer.invoke(channel, operationId, ...args)) as TResult;
  } finally {
    ipcRenderer.removeListener("on-cloud-save-sync-progress", listener);
  }
};

contextBridge.exposeInMainWorld("electron", {
  onCloudSaveAutomaticSyncModeChanged: (
    callback: (event: CloudSaveAutomaticSyncModeChangedEvent) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: CloudSaveAutomaticSyncModeChangedEvent
    ) => callback(payload);
    ipcRenderer.on("on-cloud-save-automatic-sync-mode-changed", listener);
    return () =>
      ipcRenderer.removeListener(
        "on-cloud-save-automatic-sync-mode-changed",
        listener
      );
  },
  onCloudSaveAutomaticSync: (
    callback: (event: CloudSaveAutomaticSyncEvent) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: CloudSaveAutomaticSyncEvent
    ) => callback(payload);
    ipcRenderer.on("on-cloud-save-automatic-sync", listener);
    return () =>
      ipcRenderer.removeListener("on-cloud-save-automatic-sync", listener);
  },
  getCloudSaveOverview: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke(
      "getCloudSaveOverview",
      objectId,
      shop
    ) as Promise<CloudSaveOverview>,
  getCloudSaveV2FileDetails: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke(
      "getCloudSaveV2FileDetails",
      objectId,
      shop
    ) as Promise<CloudSaveV2FileDetails>,
  deleteGameCloudSaveData: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke(
      "deleteGameCloudSaveData",
      objectId,
      shop
    ) as Promise<void>,
  getGameSnapshotVersions: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameSnapshotVersions", objectId, shop) as Promise<
      SnapshotVersionSummary[]
    >,
  restoreGameSnapshotVersion: (
    operationId: string,
    objectId: string,
    shop: GameShop,
    version: number
  ) =>
    ipcRenderer.invoke(
      "restoreGameSnapshotVersion",
      operationId,
      objectId,
      shop,
      version
    ) as Promise<RestoreRemoteSnapshotResult>,
  deleteGameSnapshotVersion: (
    objectId: string,
    shop: GameShop,
    version: number
  ) =>
    ipcRenderer.invoke(
      "deleteGameSnapshotVersion",
      objectId,
      shop,
      version
    ) as Promise<void>,
  downloadGameSnapshotVersion: (
    objectId: string,
    shop: GameShop,
    version: number
  ) =>
    ipcRenderer.invoke(
      "downloadGameSnapshotVersion",
      objectId,
      shop,
      version
    ) as Promise<{ fileCount: number; totalSizeBytes: number } | null>,
  discoverGameSaveLocations: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("discoverGameSaveLocations", objectId, shop) as Promise<
      DiscoveredSaveLocation[]
    >,
  registerDiscoveredSaveLocation: (
    objectId: string,
    shop: GameShop,
    locationPath: string
  ) =>
    ipcRenderer.invoke(
      "registerDiscoveredSaveLocation",
      objectId,
      shop,
      locationPath
    ) as Promise<SelectCloudSaveCustomPathResult>,
  fetchLatestPortableRelease: () =>
    ipcRenderer.invoke(
      "fetchLatestPortableRelease"
    ) as Promise<PortableReleaseInfo | null>,
  getPortableUpdateState: () =>
    ipcRenderer.invoke("getPortableUpdateState") as Promise<{
      release: PortableReleaseInfo | null;
      downloaded: boolean;
      downloadedVersion: string | null;
    }>,
  downloadPortableUpdate: () =>
    ipcRenderer.invoke("downloadPortableUpdate") as Promise<string>,
  applyPortableUpdate: () =>
    ipcRenderer.invoke("applyPortableUpdate") as Promise<void>,
  onPortableUpdateProgress: (listener: (percent: number) => void) => {
    const ipcListener = (_event: Electron.IpcRendererEvent, percent: number) =>
      listener(percent);
    ipcRenderer.on("on-portable-update-progress", ipcListener);
    return () =>
      ipcRenderer.removeListener("on-portable-update-progress", ipcListener);
  },
  getGoogleDriveHygieneOverview: () =>
    ipcRenderer.invoke(
      "getGoogleDriveHygieneOverview"
    ) as Promise<DriveHygieneOverview>,
  cleanupGoogleDriveTrash: () =>
    ipcRenderer.invoke(
      "cleanupGoogleDriveTrash"
    ) as Promise<DriveCleanupResult>,
  deleteGoogleDriveOrphanBlobs: () =>
    ipcRenderer.invoke(
      "deleteGoogleDriveOrphanBlobs"
    ) as Promise<DriveCleanupResult>,
  onSnapshotVersionDownloadProgress: (
    listener: (progress: {
      objectId: string;
      shop: GameShop;
      version: number;
      processedFiles: number;
      totalFiles: number;
    }) => void
  ) => {
    const ipcListener = (
      _event: Electron.IpcRendererEvent,
      progress: {
        objectId: string;
        shop: GameShop;
        version: number;
        processedFiles: number;
        totalFiles: number;
      }
    ) => listener(progress);
    ipcRenderer.on("on-snapshot-version-download-progress", ipcListener);
    return () =>
      ipcRenderer.removeListener(
        "on-snapshot-version-download-progress",
        ipcListener
      );
  },
  selectCloudSaveCustomPath: (
    objectId: string,
    shop: GameShop,
    kind: "file" | "dir" = "dir"
  ) =>
    ipcRenderer.invoke(
      "selectCloudSaveCustomPath",
      objectId,
      shop,
      kind
    ) as Promise<SelectCloudSaveCustomPathResult>,
  createCloudSaveCustomPathRebindApproval: (
    objectId: string,
    shop: GameShop,
    rawPath: string
  ) =>
    ipcRenderer.invoke(
      "createCloudSaveCustomPathRebindApproval",
      objectId,
      shop,
      rawPath
    ) as Promise<CloudSaveCustomPathApproval>,
  confirmCloudSaveCustomPathRebindApproval: (
    approvalId: string,
    objectId: string,
    shop: GameShop
  ) =>
    ipcRenderer.invoke(
      "confirmCloudSaveCustomPathRebindApproval",
      approvalId,
      objectId,
      shop
    ) as Promise<ConfirmCloudSaveCustomPathRebindApprovalResult>,
  getPendingCloudSaveCustomPathApproval: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke(
      "getPendingCloudSaveCustomPathApproval",
      objectId,
      shop
    ) as Promise<CloudSaveCustomPathApproval | null>,
  selectCloudSaveCustomPathApproval: (
    approvalId: string,
    selectedPath?: string,
    selectionMode?: "file" | "dir"
  ) =>
    ipcRenderer.invoke(
      "selectCloudSaveCustomPathApproval",
      approvalId,
      selectedPath,
      selectionMode
    ) as Promise<SelectCloudSaveCustomPathApprovalResult>,
  confirmCloudSaveCustomPathApproval: (approvalId: string) =>
    ipcRenderer.invoke(
      "confirmCloudSaveCustomPathApproval",
      approvalId
    ) as Promise<ConfirmCloudSaveCustomPathApprovalResult>,
  dismissCloudSaveCustomPathApproval: (approvalId: string) =>
    ipcRenderer.invoke(
      "dismissCloudSaveCustomPathApproval",
      approvalId
    ) as Promise<void>,
  removeCloudSaveCustomPath: (
    objectId: string,
    shop: GameShop,
    rawPath: string
  ) =>
    ipcRenderer.invoke(
      "removeCloudSaveCustomPath",
      objectId,
      shop,
      rawPath
    ) as Promise<void>,
  setCloudSaveAutomaticSyncEnabled: (
    objectId: string,
    shop: GameShop,
    enabled: boolean
  ) =>
    ipcRenderer.invoke(
      "setCloudSaveAutomaticSyncEnabled",
      objectId,
      shop,
      enabled
    ) as Promise<boolean>,
  syncCloudSaveOnGamePage: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke(
      "syncCloudSaveOnGamePage",
      objectId,
      shop
    ) as Promise<SyncCloudSaveOnGamePageResult>,
  syncGameCloudSave: (
    objectId: string,
    shop: GameShop,
    onProgress?: (progress: CloudSaveSyncProgressPayload) => void
  ) =>
    invokeCloudSaveOperation("syncGameCloudSave", [objectId, shop], onProgress),
  syncGameCloudSaveFromModal: (
    objectId: string,
    shop: GameShop,
    approvalId: string | null,
    onProgress?: (progress: CloudSaveSyncProgressPayload) => void
  ) =>
    invokeCloudSaveOperation<CloudSaveModalSyncResult>(
      "syncGameCloudSaveFromModal",
      [objectId, shop, approvalId],
      onProgress
    ),
  syncCloudSaveAfterCustomPathRebind: (
    objectId: string,
    shop: GameShop,
    rawPath: string,
    onProgress?: (progress: CloudSaveSyncProgressPayload) => void
  ) =>
    invokeCloudSaveOperation(
      "syncCloudSaveAfterCustomPathRebind",
      [objectId, shop, rawPath],
      onProgress
    ),
  resolveCloudSaveConflict: (
    objectId: string,
    shop: GameShop,
    resolution: CloudSaveConflictResolution,
    onProgress?: (progress: CloudSaveSyncProgressPayload) => void
  ) =>
    invokeCloudSaveOperation(
      "resolveCloudSaveConflict",
      [objectId, shop, resolution],
      onProgress
    ),
  /* Torrenting */
  startGameDownload: (payload: StartGameDownloadPayload) =>
    ipcRenderer.invoke("startGameDownload", payload),
  saveGlobalTrackers: (
    manual: string[],
    url: string | null,
    appendManual: boolean,
    appendUrl: boolean
  ) =>
    ipcRenderer.invoke(
      "saveGlobalTrackers",
      manual,
      url,
      appendManual,
      appendUrl
    ) as Promise<void>,
  addGameToQueue: (payload: StartGameDownloadPayload) =>
    ipcRenderer.invoke("addGameToQueue", payload),
  cancelGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("cancelGameDownload", shop, objectId),
  pauseGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameDownload", shop, objectId),
  resumeGameDownload: (
    shop: GameShop,
    objectId: string,
    strategy?: "interruptActive" | "queueIfActive"
  ) => ipcRenderer.invoke("resumeGameDownload", shop, objectId, strategy),
  pauseGameSeed: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameSeed", shop, objectId),
  resumeGameSeed: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resumeGameSeed", shop, objectId),
  updateDownloadQueuePosition: (
    shop: GameShop,
    objectId: string,
    direction: "up" | "down"
  ) =>
    ipcRenderer.invoke(
      "updateDownloadQueuePosition",
      shop,
      objectId,
      direction
    ),
  getDownloadLayoutState: () =>
    ipcRenderer.invoke(
      "getDownloadLayoutState"
    ) as Promise<DownloadLayoutState>,
  onDownloadProgress: (cb: (value: DownloadProgress | null) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: DownloadProgress | null
    ) => cb(value);
    ipcRenderer.on("on-download-progress", listener);
    return () => ipcRenderer.removeListener("on-download-progress", listener);
  },
  onHardDelete: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-hard-delete", listener);
    return () => ipcRenderer.removeListener("on-hard-delete", listener);
  },
  onSeedingStatus: (cb: (value: SeedingStatus[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: SeedingStatus[]
    ) => cb(value);
    ipcRenderer.on("on-seeding-status", listener);
    return () => ipcRenderer.removeListener("on-seeding-status", listener);
  },
  getTorrentFiles: (magnet: string) =>
    ipcRenderer.invoke("getTorrentFiles", magnet) as Promise<
      { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
    >,

  /* Catalogue */
  getGameShopDetails: (objectId: string, shop: GameShop, language: string) =>
    ipcRenderer.invoke("getGameShopDetails", objectId, shop, language),
  getGameStats: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameStats", objectId, shop),
  getGameAssets: (
    objectId: string,
    shop: GameShop,
    options?: { forceFresh?: boolean }
  ) => ipcRenderer.invoke("getGameAssets", objectId, shop, options),

  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences: Partial<UserPreferences>) =>
    ipcRenderer.invoke("updateUserPreferences", preferences),
  onUserPreferencesUpdated: (
    cb: (preferences: UserPreferences | null) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      preferences: UserPreferences | null
    ) => cb(preferences);
    ipcRenderer.on("on-user-preferences-updated", listener);
    return () =>
      ipcRenderer.removeListener("on-user-preferences-updated", listener);
  },
  autoLaunch: (autoLaunchProps: { enabled: boolean; minimized: boolean }) =>
    ipcRenderer.invoke("autoLaunch", autoLaunchProps),

  /* Download sources */
  addDownloadSource: (url: string) =>
    ipcRenderer.invoke("addDownloadSource", url),
  removeDownloadSource: (url: string, removeAll?: boolean) =>
    ipcRenderer.invoke("removeDownloadSource", url, removeAll),
  getDownloadSources: () => ipcRenderer.invoke("getDownloadSources"),
  syncDownloadSources: () => ipcRenderer.invoke("syncDownloadSources"),

  /* Library */
  setGameHydraPlaytimeEnabled: (
    shop: GameShop,
    objectId: string,
    enabled: boolean
  ) =>
    ipcRenderer.invoke("setGameHydraPlaytimeEnabled", shop, objectId, enabled),

  setGameOnlineFixMode: (shop: GameShop, objectId: string, enabled: boolean) =>
    ipcRenderer.invoke("setGameOnlineFixMode", shop, objectId, enabled),
  toggleGameMangohud: (
    shop: GameShop,
    objectId: string,
    autoRunMangohud: boolean
  ) =>
    ipcRenderer.invoke("toggleGameMangohud", shop, objectId, autoRunMangohud),
  toggleGameGamemode: (
    shop: GameShop,
    objectId: string,
    autoRunGamemode: boolean
  ) =>
    ipcRenderer.invoke("toggleGameGamemode", shop, objectId, autoRunGamemode),
  isGamemodeAvailable: () => ipcRenderer.invoke("isGamemodeAvailable"),
  isSteamAppExecutable: (appId: string, executablePath: string) =>
    ipcRenderer.invoke("isSteamAppExecutable", appId, executablePath),
  installGameOnSteam: (steamAppId: string) =>
    ipcRenderer.invoke("installGameOnSteam", steamAppId),
  isMangohudAvailable: () => ipcRenderer.invoke("isMangohudAvailable"),
  getOnlineFixStatus: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getOnlineFixStatus", shop, objectId),
  isWinetricksAvailable: () => ipcRenderer.invoke("isWinetricksAvailable"),
  addGameToLibrary: (
    shop: GameShop,
    objectId: string,
    title: string,
    platform?: string | null
  ) => ipcRenderer.invoke("addGameToLibrary", shop, objectId, title, platform),
  addCustomGameToLibrary: (
    title: string,
    executablePath: string,
    iconUrl?: string,
    logoImageUrl?: string,
    libraryHeroImageUrl?: string
  ) =>
    ipcRenderer.invoke(
      "addCustomGameToLibrary",
      title,
      executablePath,
      iconUrl,
      logoImageUrl,
      libraryHeroImageUrl
    ),
  updateCustomGame: (params: {
    shop: GameShop;
    objectId: string;
    title: string;
    iconUrl?: string;
    logoImageUrl?: string;
    libraryHeroImageUrl?: string;
    customCoverImageUrl?: string | null;
    originalIconPath?: string;
    originalLogoPath?: string;
    originalHeroPath?: string;
    customOriginalCoverPath?: string;
  }) => ipcRenderer.invoke("updateCustomGame", params),
  updateGameCustomAssets: (params: {
    shop: GameShop;
    objectId: string;
    title: string;
    customIconUrl?: string | null;
    customLogoImageUrl?: string | null;
    customHeroImageUrl?: string | null;
    customCoverImageUrl?: string | null;
    customOriginalIconPath?: string | null;
    customOriginalLogoPath?: string | null;
    customOriginalHeroPath?: string | null;
    customOriginalCoverPath?: string | null;
    customArtworkIds?: Partial<Record<ArtworkAssetType, number | null>>;
    clearArtworkTypes?: ArtworkAssetType[];
  }) => ipcRenderer.invoke("updateGameCustomAssets", params),
  getCoverPoster: (url: string): Promise<string | null> =>
    ipcRenderer.invoke("getCoverPoster", url),
  createGameShortcut: (
    shop: GameShop,
    objectId: string,
    location: ShortcutLocation
  ) => ipcRenderer.invoke("createGameShortcut", shop, objectId, location),
  updateExecutablePath: (
    shop: GameShop,
    objectId: string,
    executablePath: string | null
  ) =>
    ipcRenderer.invoke("updateExecutablePath", shop, objectId, executablePath),
  updateTrackingExecutablePaths: (
    shop: GameShop,
    objectId: string,
    trackingExecutablePaths: string[]
  ) =>
    ipcRenderer.invoke(
      "updateTrackingExecutablePaths",
      shop,
      objectId,
      trackingExecutablePaths
    ),
  addGameToFavorites: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("addGameToFavorites", shop, objectId),
  removeGameFromFavorites: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGameFromFavorites", shop, objectId),
  setGameVisibility: (shop: GameShop, objectId: string, isConcealed: boolean) =>
    ipcRenderer.invoke("setGameVisibility", shop, objectId, isConcealed),
  clearNewDownloadOptions: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("clearNewDownloadOptions", shop, objectId),
  toggleGamePin: (shop: GameShop, objectId: string, pinned: boolean) =>
    ipcRenderer.invoke("toggleGamePin", shop, objectId, pinned),

  selectGameWinePrefix: (
    shop: GameShop,
    objectId: string,
    winePrefixPath: string | null
  ) =>
    ipcRenderer.invoke("selectGameWinePrefix", shop, objectId, winePrefixPath),
  selectGameProtonPath: (
    shop: GameShop,
    objectId: string,
    protonPath: string | null
  ) => ipcRenderer.invoke("selectGameProtonPath", shop, objectId, protonPath),
  getInstalledProtonVersions: () =>
    ipcRenderer.invoke("getInstalledProtonVersions") as Promise<
      ProtonVersion[]
    >,
  getGameLaunchProtonVersion: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameLaunchProtonVersion", shop, objectId),
  getProtonProviders: () =>
    ipcRenderer.invoke("getProtonProviders") as Promise<ProtonProvider[]>,
  getProtonReleases: (providerId: string, page?: number) =>
    ipcRenderer.invoke("getProtonReleases", providerId, page) as Promise<{
      releases: ProtonRelease[];
      hasMore: boolean;
    }>,
  getProtonInstallTargets: () =>
    ipcRenderer.invoke("getProtonInstallTargets") as Promise<
      ProtonInstallTarget[]
    >,
  installProtonRelease: (providerId: string, tag: string) =>
    ipcRenderer.invoke("installProtonRelease", providerId, tag) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  cancelProtonInstall: (providerId: string, tag: string) =>
    ipcRenderer.invoke("cancelProtonInstall", providerId, tag),
  removeInstalledProton: (protonPath: string) =>
    ipcRenderer.invoke("removeInstalledProton", protonPath) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  onProtonInstallProgress: (cb: (progress: ProtonInstallProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: ProtonInstallProgress
    ) => cb(progress);
    ipcRenderer.on("on-proton-install-progress", listener);
    return () =>
      ipcRenderer.removeListener("on-proton-install-progress", listener);
  },
  verifyExecutablePathInUse: (executablePath: string) =>
    ipcRenderer.invoke("verifyExecutablePathInUse", executablePath),
  getLibrary: (includeConcealed = false) =>
    ipcRenderer.invoke("getLibrary", includeConcealed),
  getHiddenLibrary: () => ipcRenderer.invoke("getHiddenLibrary"),
  openGameInstaller: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameInstaller", shop, objectId),
  getGameInstallerActionType: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameInstallerActionType", shop, objectId),
  openGameInstallerPath: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameInstallerPath", shop, objectId),
  openGameWinetricks: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameWinetricks", shop, objectId),
  openGameExecutablePath: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameExecutablePath", shop, objectId),
  getGameSaveFolder: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameSaveFolder", shop, objectId),
  openGameSaveFolder: (
    shop: GameShop,
    objectId: string,
    saveFolderPath: string
  ) => ipcRenderer.invoke("openGameSaveFolder", shop, objectId, saveFolderPath),
  openGame: (
    shop: GameShop,
    objectId: string,
    executablePath: string,
    launchOptions?: string | null
  ) =>
    ipcRenderer.invoke(
      "openGame",
      shop,
      objectId,
      executablePath,
      launchOptions
    ),
  closeGame: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("closeGame", shop, objectId),
  removeGameFromLibrary: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGameFromLibrary", shop, objectId),
  removeGame: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGame", shop, objectId),
  deleteGameFolder: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("deleteGameFolder", shop, objectId),
  getGameByObjectId: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameByObjectId", shop, objectId),
  extractGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("extractGameDownload", shop, objectId),
  scanInstalledGames: (
    additionalDirectories?: string[],
    includeDefaultDirectories?: boolean,
    addGamesToLibrary?: boolean,
    requestId?: string
  ) =>
    ipcRenderer.invoke(
      "scanInstalledGames",
      additionalDirectories,
      includeDefaultDirectories,
      addGamesToLibrary,
      requestId
    ),
  cancelScanInstalledGames: (requestId: string) =>
    ipcRenderer.invoke("cancelScanInstalledGames", requestId),
  addScannedGames: (picks: { objectId: string; executablePath: string }[]) =>
    ipcRenderer.invoke("addScannedGames", picks),
  getDefaultWinePrefixSelectionPath: () =>
    ipcRenderer.invoke("getDefaultWinePrefixSelectionPath"),
  createSteamShortcut: (
    shop: GameShop,
    objectId: string,
    options?: CreateSteamShortcutOptions
  ) => ipcRenderer.invoke("createSteamShortcut", shop, objectId, options),
  deleteSteamShortcut: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("deleteSteamShortcut", shop, objectId),
  checkSteamShortcut: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("checkSteamShortcut", shop, objectId),
  onGamesRunning: (
    cb: (
      gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
    ) => void
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, gamesRunning) =>
      cb(gamesRunning);
    ipcRenderer.on("on-games-running", listener);
    return () => ipcRenderer.removeListener("on-games-running", listener);
  },
  onLibraryBatchComplete: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-library-batch-complete", listener);
    return () =>
      ipcRenderer.removeListener("on-library-batch-complete", listener);
  },
  onDownloadsUpdated: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-downloads-updated", listener);
    return () => ipcRenderer.removeListener("on-downloads-updated", listener);
  },
  onExtractionComplete: (cb: (shop: GameShop, objectId: string) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string
    ) => cb(shop, objectId);
    ipcRenderer.on("on-extraction-complete", listener);
    return () => ipcRenderer.removeListener("on-extraction-complete", listener);
  },
  onExtractionProgress: (
    cb: (shop: GameShop, objectId: string, progress: number) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string,
      progress: number
    ) => cb(shop, objectId, progress);
    ipcRenderer.on("on-extraction-progress", listener);
    return () => ipcRenderer.removeListener("on-extraction-progress", listener);
  },
  onExtractionFailed: (
    cb: (
      shop: GameShop,
      objectId: string,
      failure: ExtractionFailure | null
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string,
      failure: ExtractionFailure | null
    ) => cb(shop, objectId, failure);
    ipcRenderer.on("on-extraction-failed", listener);
    return () => ipcRenderer.removeListener("on-extraction-failed", listener);
  },
  onDownloadHalted: (cb: (gameTitle: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, gameTitle: string) =>
      cb(gameTitle);
    ipcRenderer.on("on-download-halted", listener);
    return () => ipcRenderer.removeListener("on-download-halted", listener);
  },
  onGameExecutableNotFound: (
    cb: (shop: GameShop, objectId: string) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string
    ) => cb(shop, objectId);
    ipcRenderer.on("on-game-executable-not-found", listener);
    return () =>
      ipcRenderer.removeListener("on-game-executable-not-found", listener);
  },
  onArchiveDeletionPrompt: (cb: (archivePaths: string[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      archivePaths: string[]
    ) => cb(archivePaths);
    ipcRenderer.on("on-archive-deletion-prompt", listener);
    return () =>
      ipcRenderer.removeListener("on-archive-deletion-prompt", listener);
  },
  deleteArchive: (filePath: string) =>
    ipcRenderer.invoke("deleteArchive", filePath),

  /* Hardware */
  getDiskFreeSpace: (path: string) =>
    ipcRenderer.invoke("getDiskFreeSpace", path),
  checkFolderWritePermission: (path: string) =>
    ipcRenderer.invoke("checkFolderWritePermission", path),
  getNetworkInterfaces: () => ipcRenderer.invoke("getNetworkInterfaces"),

  /* Cloud save (Hydra Plus: Google Drive only) */

  /* Misc */
  ping: () => ipcRenderer.invoke("ping"),
  getVersion: () => ipcRenderer.invoke("getVersion"),
  getDefaultDownloadsPath: () => ipcRenderer.invoke("getDefaultDownloadsPath"),
  getAppSessionId: () => ipcRenderer.invoke("getAppSessionId"),
  isStaging: () => ipcRenderer.invoke("isStaging"),
  isPortableVersion: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  openExternal: (src: string) => ipcRenderer.invoke("openExternal", src),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("showOpenDialog", options),
  getImageDataUrl: (imageUrl: string) =>
    ipcRenderer.invoke("getImageDataUrl", imageUrl),
  getProcessedImage: (
    imageUrl: string | null,
    options: { width: number; height: number; preserveAnimation?: boolean }
  ) => ipcRenderer.invoke("getProcessedImage", imageUrl, options),
  hydraApi: {
    get: (
      url: string,
      options?: {
        params?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
        ifModifiedSince?: Date;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "get",
        url,
        params: options?.params,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
          ifModifiedSince: options?.ifModifiedSince,
        },
      }),
    post: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "post",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    postResponse: <T = unknown>(
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
        acceptedStatuses?: number[];
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "postResponse",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
          acceptedStatuses: options?.acceptedStatuses,
        },
      }) as Promise<{ status: number; data: T }>,
    put: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "put",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    patch: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "patch",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    delete: (
      url: string,
      options?: {
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "delete",
        url,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
  },
  canInstallCommonRedist: () => ipcRenderer.invoke("canInstallCommonRedist"),
  installCommonRedist: () => ipcRenderer.invoke("installCommonRedist"),
  platform: process.platform,
  isWayland:
    process.platform === "linux" &&
    (process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland" ||
      Boolean(process.env.WAYLAND_DISPLAY)),

  /* Auto update */
  onAutoUpdaterEvent: (cb: (value: AppUpdaterEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: AppUpdaterEvent
    ) => cb(value);

    ipcRenderer.on("autoUpdaterEvent", listener);

    return () => {
      ipcRenderer.removeListener("autoUpdaterEvent", listener);
    };
  },
  onCommonRedistProgress: (
    cb: (value: { log: string; complete: boolean }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { log: string; complete: boolean }
    ) => cb(value);
    ipcRenderer.on("common-redist-progress", listener);
    return () => ipcRenderer.removeListener("common-redist-progress", listener);
  },
  onPreflightProgress: (
    cb: (value: { status: string; detail: string | null }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { status: string; detail: string | null }
    ) => cb(value);
    ipcRenderer.on("preflight-progress", listener);
    return () => ipcRenderer.removeListener("preflight-progress", listener);
  },
  checkForUpdates: () => ipcRenderer.invoke("checkForUpdates"),
  restartAndInstallUpdate: () => ipcRenderer.invoke("restartAndInstallUpdate"),

  /* Auth */
  startGoogleAuth: () => ipcRenderer.invoke("startGoogleAuth"),
  disconnectGoogleDrive: () => ipcRenderer.invoke("disconnectGoogleDrive"),
  getGoogleDriveStatus: () => ipcRenderer.invoke("getGoogleDriveStatus"),

  /* Hydra account (sign in restores the profile's download sources) */
  openAuthWindow: () => ipcRenderer.invoke("openAuthWindow"),
  signOut: () => ipcRenderer.invoke("signOut"),
  getMe: () => ipcRenderer.invoke("getMe"),
  minimizeAuthWindow: () => ipcRenderer.invoke("minimizeAuthWindow"),
  closeAuthWindow: () => ipcRenderer.invoke("closeAuthWindow"),
  onSignIn: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-signin", listener);
    return () => ipcRenderer.removeListener("on-signin", listener);
  },
  onSignOut: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-signout", listener);
    return () => ipcRenderer.removeListener("on-signout", listener);
  },

  onNewDownloadOptions: (
    cb: (gamesWithNewOptions: { gameId: string; count: number }[]) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      gamesWithNewOptions: { gameId: string; count: number }[]
    ) => cb(gamesWithNewOptions);
    ipcRenderer.on("on-new-download-options", listener);
    return () =>
      ipcRenderer.removeListener("on-new-download-options", listener);
  },

  /* Main Window Controls */
  minimizeMainWindow: () => ipcRenderer.invoke("minimizeMainWindow"),
  toggleMaximizeMainWindow: () =>
    ipcRenderer.invoke("toggleMaximizeMainWindow"),
  closeMainWindow: () => ipcRenderer.invoke("closeMainWindow"),
  isMainWindowMaximized: () =>
    ipcRenderer.invoke("isMainWindowMaximized") as Promise<boolean>,
  onWindowMaximizeChange: (cb: (isMaximized: boolean) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      isMaximized: boolean
    ) => cb(isMaximized);
    ipcRenderer.on("on-window-maximize-change", listener);
    return () =>
      ipcRenderer.removeListener("on-window-maximize-change", listener);
  },

  onProfileUpdated: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-profile-updated", listener);
    return () => ipcRenderer.removeListener("on-profile-updated", listener);
  },
  onNavigate: (cb: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) =>
      cb(path);
    ipcRenderer.on("on-navigate", listener);
    return () => ipcRenderer.removeListener("on-navigate", listener);
  },

  /* Game Launcher Window */
  showGameLauncherWindow: () => ipcRenderer.invoke("showGameLauncherWindow"),
  closeGameLauncherWindow: () => ipcRenderer.invoke("closeGameLauncherWindow"),
  openMainWindow: () => ipcRenderer.invoke("openMainWindow"),
  isMainWindowOpen: () => ipcRenderer.invoke("isMainWindowOpen"),

  /* LevelDB Generic CRUD */
  leveldb: {
    get: (
      key: string,
      sublevelName?: string | null,
      valueEncoding?: "json" | "utf8"
    ) => ipcRenderer.invoke("leveldbGet", key, sublevelName, valueEncoding),
    put: (
      key: string,
      value: unknown,
      sublevelName?: string | null,
      valueEncoding?: "json" | "utf8"
    ) =>
      ipcRenderer.invoke("leveldbPut", key, value, sublevelName, valueEncoding),
    del: (key: string, sublevelName?: string | null) =>
      ipcRenderer.invoke("leveldbDel", key, sublevelName),
    clear: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbClear", sublevelName),
    values: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbValues", sublevelName),
    iterator: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbIterator", sublevelName),
  },

  cancelGameTransfer: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("cancelGameTransfer", shop, objectId),

  // Add these to the electron object in contextBridge.exposeInMainWorld
  on: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.off(channel, listener);
  },
  getAvailableDrives: () => ipcRenderer.invoke("getAvailableDrives"),
  transferGameFiles: (shop: GameShop, objectId: string, destParent: string) =>
    ipcRenderer.invoke("transferGameFiles", shop, objectId, destParent),
});

const reportNetworkStatus = (online: boolean, switched = false) => {
  ipcRenderer.invoke("updateNetworkStatus", { online, switched }).catch(() => {
    return undefined;
  });
};

if (globalThis.window !== undefined) {
  globalThis.addEventListener("online", () => reportNetworkStatus(true, true));
  globalThis.addEventListener("offline", () => reportNetworkStatus(false));

  const connection = (
    navigator as Navigator & {
      connection?: {
        addEventListener?: (type: string, listener: () => void) => void;
      };
    }
  ).connection;

  connection?.addEventListener?.("change", () =>
    reportNetworkStatus(navigator.onLine, true)
  );
}
