import type {
  AppUpdaterEvent,
  GameShop,
  GoogleDriveCloudStatus,
  DownloadProgress,
  SeedingStatus,
  UserPreferences,
  UserDetails,
  StartGameDownloadPayload,
  RealDebridUser,
  PremiumizeUser,
  AllDebridUser,
  GameStats,
  LibraryGame,
  GameRunning,
  TorBoxUser,
  ShortcutLocation,
  ShopAssets,
  ShopDetailsWithAssets,
  Game,
  DiskUsage,
  NetworkInterface,
  DownloadSource,
  ProtonVersion,
  CreateSteamShortcutOptions,
  TorrentFilesResponse,
  DownloadLayoutState,
  ArtworkAssetType,
  CloudSaveAutomaticSyncModeChangedEvent,
  CloudSaveAutomaticSyncEvent,
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveV2FileDetails,
  CloudSaveSyncProgressPayload,
  SyncCloudSaveOnGamePageResult,
  SyncGameCloudSaveResult,
  SelectCloudSaveCustomPathResult,
  SnapshotVersionSummary,
  RestoreRemoteSnapshotResult,
  DiscoveredSaveLocation,
  PortableReleaseInfo,
  DriveHygieneOverview,
  DriveCleanupResult,
  CloudSaveCustomPathApproval,
  CloudSaveModalSyncResult,
  SelectCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathRebindApprovalResult,
  ExtractionFailure,
} from "@types";

export interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

declare global {
  declare module "*.svg" {
    const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
    export default content;
  }

  interface Electron {
    onCloudSaveAutomaticSyncModeChanged: (
      callback: (event: CloudSaveAutomaticSyncModeChangedEvent) => void
    ) => () => void;
    onCloudSaveAutomaticSync: (
      callback: (event: CloudSaveAutomaticSyncEvent) => void
    ) => () => void;
    getCloudSaveOverview: (
      objectId: string,
      shop: GameShop
    ) => Promise<CloudSaveOverview>;
    getCloudSaveV2FileDetails: (
      objectId: string,
      shop: GameShop
    ) => Promise<CloudSaveV2FileDetails>;
    deleteGameCloudSaveData: (
      objectId: string,
      shop: GameShop
    ) => Promise<void>;
    getGameSnapshotVersions: (
      objectId: string,
      shop: GameShop
    ) => Promise<SnapshotVersionSummary[]>;
    restoreGameSnapshotVersion: (
      operationId: string,
      objectId: string,
      shop: GameShop,
      version: number
    ) => Promise<RestoreRemoteSnapshotResult>;
    deleteGameSnapshotVersion: (
      objectId: string,
      shop: GameShop,
      version: number
    ) => Promise<void>;
    downloadGameSnapshotVersion: (
      objectId: string,
      shop: GameShop,
      version: number
    ) => Promise<{ fileCount: number; totalSizeBytes: number } | null>;
    discoverGameSaveLocations: (
      objectId: string,
      shop: GameShop
    ) => Promise<DiscoveredSaveLocation[]>;
    registerDiscoveredSaveLocation: (
      objectId: string,
      shop: GameShop,
      locationPath: string
    ) => Promise<SelectCloudSaveCustomPathResult>;
    fetchLatestPortableRelease: () => Promise<PortableReleaseInfo | null>;
    getPortableUpdateState: () => Promise<{
      release: PortableReleaseInfo | null;
      downloaded: boolean;
      downloadedVersion: string | null;
    }>;
    downloadPortableUpdate: () => Promise<string>;
    applyPortableUpdate: () => Promise<void>;
    onPortableUpdateProgress: (
      listener: (percent: number) => void
    ) => () => void;
    getGoogleDriveHygieneOverview: () => Promise<DriveHygieneOverview>;
    cleanupGoogleDriveTrash: () => Promise<DriveCleanupResult>;
    deleteGoogleDriveOrphanBlobs: () => Promise<DriveCleanupResult>;
    onSnapshotVersionDownloadProgress: (
      listener: (progress: {
        objectId: string;
        shop: GameShop;
        version: number;
        processedFiles: number;
        totalFiles: number;
      }) => void
    ) => () => void;
    selectCloudSaveCustomPath: (
      objectId: string,
      shop: GameShop,
      kind?: "file" | "dir"
    ) => Promise<SelectCloudSaveCustomPathResult>;
    createCloudSaveCustomPathRebindApproval: (
      objectId: string,
      shop: GameShop,
      rawPath: string
    ) => Promise<CloudSaveCustomPathApproval>;
    confirmCloudSaveCustomPathRebindApproval: (
      approvalId: string,
      objectId: string,
      shop: GameShop
    ) => Promise<ConfirmCloudSaveCustomPathRebindApprovalResult>;
    getPendingCloudSaveCustomPathApproval: (
      objectId: string,
      shop: GameShop
    ) => Promise<CloudSaveCustomPathApproval | null>;
    selectCloudSaveCustomPathApproval: (
      approvalId: string,
      selectedPath?: string,
      selectionMode?: "file" | "dir"
    ) => Promise<SelectCloudSaveCustomPathApprovalResult>;
    confirmCloudSaveCustomPathApproval: (
      approvalId: string
    ) => Promise<ConfirmCloudSaveCustomPathApprovalResult>;
    dismissCloudSaveCustomPathApproval: (approvalId: string) => Promise<void>;
    removeCloudSaveCustomPath: (
      objectId: string,
      shop: GameShop,
      rawPath: string
    ) => Promise<void>;
    setCloudSaveAutomaticSyncEnabled: (
      objectId: string,
      shop: GameShop,
      enabled: boolean
    ) => Promise<boolean>;
    syncCloudSaveOnGamePage: (
      objectId: string,
      shop: GameShop
    ) => Promise<SyncCloudSaveOnGamePageResult>;
    syncGameCloudSave: (
      objectId: string,
      shop: GameShop,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<SyncGameCloudSaveResult>;
    syncGameCloudSaveFromModal: (
      objectId: string,
      shop: GameShop,
      approvalId: string | null,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<CloudSaveModalSyncResult>;
    syncCloudSaveAfterCustomPathRebind: (
      objectId: string,
      shop: GameShop,
      rawPath: string,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<SyncGameCloudSaveResult>;
    resolveCloudSaveConflict: (
      objectId: string,
      shop: GameShop,
      resolution: CloudSaveConflictResolution,
      onProgress?: (progress: CloudSaveSyncProgressPayload) => void
    ) => Promise<SyncGameCloudSaveResult>;
    /* Torrenting */
    startGameDownload: (
      payload: StartGameDownloadPayload
    ) => Promise<{ ok: boolean; error?: string }>;
    addGameToQueue: (
      payload: StartGameDownloadPayload
    ) => Promise<{ ok: boolean; error?: string }>;
    cancelGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    pauseGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameDownload: (
      shop: GameShop,
      objectId: string,
      strategy?: "interruptActive" | "queueIfActive"
    ) => Promise<void>;
    pauseGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    saveGlobalTrackers: (
      manual: string[],
      url: string | null,
      appendManual: boolean,
      appendUrl: boolean
    ) => Promise<void>;
    updateDownloadQueuePosition: (
      shop: GameShop,
      objectId: string,
      direction: "up" | "down"
    ) => Promise<boolean>;
    getDownloadLayoutState: () => Promise<DownloadLayoutState>;
    onDownloadProgress: (
      cb: (value: DownloadProgress | null) => void
    ) => () => Electron.IpcRenderer;
    onSeedingStatus: (
      cb: (value: SeedingStatus[]) => void
    ) => () => Electron.IpcRenderer;
    onHardDelete: (cb: () => void) => () => Electron.IpcRenderer;
    getTorrentFiles: (
      magnet: string
    ) => Promise<
      { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
    >;

    /* Catalogue */
    getGameShopDetails: (
      objectId: string,
      shop: GameShop,
      language: string
    ) => Promise<ShopDetailsWithAssets | null>;
    getGameStats: (objectId: string, shop: GameShop) => Promise<GameStats>;
    getGameAssets: (
      objectId: string,
      shop: GameShop,
      options?: { forceFresh?: boolean }
    ) => Promise<ShopAssets | null>;
    /* Library */
    setGameHydraPlaytimeEnabled: (
      shop: GameShop,
      objectId: string,
      enabled: boolean
    ) => Promise<void>;
    setGameOnlineFixMode: (
      shop: GameShop,
      objectId: string,
      enabled: boolean
    ) => Promise<void>;
    toggleGameMangohud: (
      shop: GameShop,
      objectId: string,
      autoRunMangohud: boolean
    ) => Promise<void>;
    toggleGameGamemode: (
      shop: GameShop,
      objectId: string,
      autoRunGamemode: boolean
    ) => Promise<void>;
    isGamemodeAvailable: () => Promise<boolean>;
    isSteamAppExecutable: (
      appId: string,
      executablePath: string
    ) => Promise<boolean>;
    installGameOnSteam: (steamAppId: string) => Promise<void>;
    isMangohudAvailable: () => Promise<boolean>;
    getOnlineFixStatus: (
      shop: GameShop,
      objectId: string
    ) => Promise<{
      steamRunning: boolean;
      onlineFixDetected: boolean | null;
      steamInstallKind: "native" | "flatpak" | "snap" | "unknown";
      lastLaunchError: string | null;
    }>;
    isWinetricksAvailable: () => Promise<boolean>;
    addGameToLibrary: (
      shop: GameShop,
      objectId: string,
      title: string,
      platform?: string | null
    ) => Promise<void>;
    addCustomGameToLibrary: (
      title: string,
      executablePath: string,
      iconUrl?: string,
      logoImageUrl?: string,
      libraryHeroImageUrl?: string
    ) => Promise<Game>;
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
    }) => Promise<Game>;
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
    }) => Promise<Game>;
    getCoverPoster: (url: string) => Promise<string | null>;
    createGameShortcut: (
      shop: GameShop,
      objectId: string,
      location: ShortcutLocation
    ) => Promise<boolean>;
    updateExecutablePath: (
      shop: GameShop,
      objectId: string,
      executablePath: string | null
    ) => Promise<void>;
    updateTrackingExecutablePaths: (
      shop: GameShop,
      objectId: string,
      trackingExecutablePaths: string[]
    ) => Promise<void>;
    addGameToFavorites: (shop: GameShop, objectId: string) => Promise<void>;
    removeGameFromFavorites: (
      shop: GameShop,
      objectId: string
    ) => Promise<void>;
    clearNewDownloadOptions: (
      shop: GameShop,
      objectId: string
    ) => Promise<void>;
    toggleGamePin: (
      shop: GameShop,
      objectId: string,
      pinned: boolean
    ) => Promise<void>;
    selectGameWinePrefix: (
      shop: GameShop,
      objectId: string,
      winePrefixPath: string | null
    ) => Promise<void>;
    selectGameProtonPath: (
      shop: GameShop,
      objectId: string,
      protonPath: string | null
    ) => Promise<void>;
    getInstalledProtonVersions: () => Promise<ProtonVersion[]>;
    getGameLaunchProtonVersion: (
      shop: GameShop,
      objectId: string
    ) => Promise<string | null>;
    verifyExecutablePathInUse: (executablePath: string) => Promise<Game>;
    getLibrary: (includeConcealed?: boolean) => Promise<LibraryGame[]>;
    getHiddenLibrary: () => Promise<LibraryGame[]>;
    setGameVisibility: (
      shop: GameShop,
      objectId: string,
      isConcealed: boolean
    ) => Promise<{ isConcealed: boolean }>;
    openGameInstaller: (shop: GameShop, objectId: string) => Promise<boolean>;
    getGameInstallerActionType: (
      shop: GameShop,
      objectId: string
    ) => Promise<"install" | "open-folder">;
    openGameInstallerPath: (shop: GameShop, objectId: string) => Promise<void>;
    openGameWinetricks: (shop: GameShop, objectId: string) => Promise<boolean>;
    openGameExecutablePath: (shop: GameShop, objectId: string) => Promise<void>;
    getGameSaveFolder: (
      shop: GameShop,
      objectId: string
    ) => Promise<string | null>;
    openGameSaveFolder: (
      shop: GameShop,
      objectId: string,
      saveFolderPath: string
    ) => Promise<boolean>;
    openGame: (
      shop: GameShop,
      objectId: string,
      executablePath: string,
      launchOptions?: string | null
    ) => Promise<void>;
    closeGame: (shop: GameShop, objectId: string) => Promise<boolean>;
    removeGameFromLibrary: (shop: GameShop, objectId: string) => Promise<void>;
    removeGame: (shop: GameShop, objectId: string) => Promise<void>;
    deleteGameFolder: (shop: GameShop, objectId: string) => Promise<unknown>;
    getGameByObjectId: (
      shop: GameShop,
      objectId: string
    ) => Promise<LibraryGame | null>;
    onGamesRunning: (
      cb: (
        gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onLibraryBatchComplete: (cb: () => void) => () => Electron.IpcRenderer;
    onDownloadsUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    /* User preferences */
    authenticateRealDebrid: (apiToken: string) => Promise<RealDebridUser>;
    authenticatePremiumize: (apiToken: string) => Promise<PremiumizeUser>;
    authenticateAllDebrid: (apiToken: string) => Promise<AllDebridUser>;
    authenticateTorBox: (apiToken: string) => Promise<TorBoxUser>;
    getUserPreferences: () => Promise<UserPreferences | null>;
    updateUserPreferences: (
      preferences: Partial<UserPreferences>
    ) => Promise<void>;
    onUserPreferencesUpdated: (
      cb: (preferences: UserPreferences | null) => void
    ) => () => Electron.IpcRenderer;
    autoLaunch: (autoLaunchProps: {
      enabled: boolean;
      minimized: boolean;
    }) => Promise<void>;
    extractGameDownload: (shop: GameShop, objectId: string) => Promise<boolean>;
    scanInstalledGames: (
      additionalDirectories?: string[],
      includeDefaultDirectories?: boolean,
      addGamesToLibrary?: boolean,
      requestId?: string
    ) => Promise<{
      linkedGames: {
        title: string;
        executablePath: string;
        iconUrl: string | null;
      }[];
      addedGames: {
        title: string;
        executablePath: string;
        iconUrl: string | null;
      }[];
      ambiguousMatches: {
        executablePath: string;
        choices: { objectId: string; title: string; iconUrl: string | null }[];
      }[];
      total: number;
    }>;
    cancelScanInstalledGames: (requestId: string) => Promise<void>;
    addScannedGames: (
      picks: { objectId: string; executablePath: string }[]
    ) => Promise<
      {
        title: string;
        executablePath: string;
        iconUrl: string | null;
      }[]
    >;
    onExtractionComplete: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    onExtractionProgress: (
      cb: (shop: GameShop, objectId: string, progress: number) => void
    ) => () => Electron.IpcRenderer;
    onExtractionFailed: (
      cb: (
        shop: GameShop,
        objectId: string,
        failure: ExtractionFailure | null
      ) => void
    ) => () => Electron.IpcRenderer;
    onDownloadHalted: (
      cb: (gameTitle: string) => void
    ) => () => Electron.IpcRenderer;
    onGameExecutableNotFound: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    onArchiveDeletionPrompt: (
      cb: (archivePaths: string[]) => void
    ) => () => Electron.IpcRenderer;
    deleteArchive: (filePath: string) => Promise<boolean>;
    getDefaultWinePrefixSelectionPath: () => Promise<string | null>;
    createSteamShortcut: (
      shop: GameShop,
      objectId: string,
      options?: CreateSteamShortcutOptions
    ) => Promise<void>;
    deleteSteamShortcut: (shop: GameShop, objectId: string) => Promise<void>;
    checkSteamShortcut: (shop: GameShop, objectId: string) => Promise<boolean>;

    /* Download sources */
    addDownloadSource: (url: string) => Promise<DownloadSource>;
    removeDownloadSource: (
      removeAll = false,
      downloadSourceId?: string
    ) => Promise<void>;
    getDownloadSources: () => Promise<DownloadSource[]>;
    syncDownloadSources: () => Promise<void>;

    /* Hardware */
    getDiskFreeSpace: (path: string) => Promise<DiskUsage | null>;
    checkFolderWritePermission: (path: string) => Promise<boolean>;
    getNetworkInterfaces: () => Promise<NetworkInterface[]>;

    /* Cloud save (Hydra Plus: Google Drive only) */

    /* Clipboard */

    /* Misc */
    openExternal: (src: string) => Promise<void>;
    getVersion: () => Promise<string>;
    getAppSessionId: () => Promise<string>;
    isStaging: () => Promise<boolean>;
    ping: () => string;
    getDefaultDownloadsPath: () => Promise<string>;
    isPortableVersion: boolean;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    getImageDataUrl: (imageUrl: string) => Promise<string | null>;
    getProcessedImage: (
      imageUrl: string | null,
      options: { width: number; height: number; preserveAnimation?: boolean }
    ) => Promise<string | null>;
    hydraApi: {
      get: <T = unknown>(
        url: string,
        options?: {
          params?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
          ifModifiedSince?: Date;
        }
      ) => Promise<T>;
      post: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      postResponse: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
          acceptedStatuses?: number[];
        }
      ) => Promise<{ status: number; data: T }>;
      put: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      patch: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      delete: <T = unknown>(
        url: string,
        options?: {
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
    };
    canInstallCommonRedist: () => Promise<boolean>;
    installCommonRedist: () => Promise<void>;
    onCommonRedistProgress: (
      cb: (value: { log: string; complete: boolean }) => void
    ) => () => Electron.IpcRenderer;
    onPreflightProgress: (
      cb: (value: { status: string; detail: string | null }) => void
    ) => () => Electron.IpcRenderer;
    platform: NodeJS.Platform;
    isWayland: boolean;

    /* Auto update */
    onAutoUpdaterEvent: (
      cb: (event: AppUpdaterEvent) => void
    ) => () => Electron.IpcRenderer;
    checkForUpdates: () => Promise<boolean>;
    restartAndInstallUpdate: () => Promise<void>;

    /* Auth */
    startGoogleAuth: () => Promise<{ linked: true }>;
    disconnectGoogleDrive: () => Promise<{ ok: boolean }>;
    getGoogleDriveStatus: () => Promise<GoogleDriveCloudStatus>;

    /* Hydra account (sign in restores the profile's download sources) */
    openAuthWindow: () => Promise<void>;
    signOut: () => Promise<void>;
    getMe: () => Promise<UserDetails | null>;
    minimizeAuthWindow: () => Promise<void>;
    closeAuthWindow: () => Promise<void>;
    onSignIn: (cb: () => void) => () => void;
    onSignOut: (cb: () => void) => () => void;

    /* Game Launcher Window */
    showGameLauncherWindow: () => Promise<void>;
    closeGameLauncherWindow: () => Promise<void>;
    openMainWindow: () => Promise<void>;
    isMainWindowOpen: () => Promise<boolean>;

    /* Main Window Controls */
    minimizeMainWindow: () => Promise<void>;
    toggleMaximizeMainWindow: () => Promise<void>;
    closeMainWindow: () => Promise<void>;
    isMainWindowMaximized: () => Promise<boolean>;
    onWindowMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void;

    onProfileUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    onNavigate: (cb: (path: string) => void) => () => Electron.IpcRenderer;

    /* Download Options */
    onNewDownloadOptions: (
      cb: (gamesWithNewOptions: { gameId: string; count: number }[]) => void
    ) => () => Electron.IpcRenderer;

    /* LevelDB Generic CRUD */
    leveldb: {
      get: (
        key: string,
        sublevelName?: string | null,
        valueEncoding?: "json" | "utf8"
      ) => Promise<unknown>;
      put: (
        key: string,
        value: unknown,
        sublevelName?: string | null,
        valueEncoding?: "json" | "utf8"
      ) => Promise<void>;
      del: (key: string, sublevelName?: string | null) => Promise<void>;
      clear: (sublevelName: string) => Promise<void>;
      values: (sublevelName: string) => Promise<unknown[]>;
      iterator: (sublevelName: string) => Promise<[string, unknown][]>;
    };

    /* Transfer Game */
    getAvailableDrives: () => Promise<DriveInfo[]>;
    transferGameFiles: (
      shop: GameShop,
      objectId: string,
      destParent: string
    ) => Promise<{
      ok: boolean;
      error?: string;
      needed?: number;
      available?: number;
      newExePath?: string;
    }>;

    // Cancel for game transfers
    cancelGameTransfer: (shop: GameShop, objectId: string) => Promise<void>;

    /* Event listeners for transfer progress */
    on: (channel: string, listener: (...args) => void) => void;
    off: (channel: string, listener: (...args) => void) => void;
  }

  interface Window {
    electron: Electron;
  }
}
