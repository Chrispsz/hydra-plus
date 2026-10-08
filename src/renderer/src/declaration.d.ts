import type { AuthPage } from "@shared";
import type {
  AppUpdaterEvent,
  GameShop,
  GoogleDriveCloudStatus,
  Steam250Game,
  DownloadProgress,
  SeedingStatus,
  UserPreferences,
  StartGameDownloadPayload,
  RealDebridUser,
  PremiumizeUser,
  AllDebridUser,
  UserProfile,
  UpdateProfileRequest,
  OpenCheckoutOptions,
  GameStats,
  UserDetails,
  NotificationSync,
  GameArtifact,
  LudusaviBackup,
  LibraryGame,
  GameRunning,
  TorBoxUser,
  Auth,
  ShortcutLocation,
  ShopAssets,
  ShopDetailsWithAssets,
  Game,
  DiskUsage,
  NetworkInterface,
  DownloadSource,
  LocalNotification,
  ProtonVersion,
  CompatibilityDiagnostic,
  CreateSteamShortcutOptions,
  TorrentFilesResponse,
  DownloadLayoutState,
  ArtworkAssetType,
  ArtworkKind,
  ArtworkPage,
  GameArtworkSelection,
  GameLauncherStatusPayload,
  CloudSaveAutomaticSyncModeChangedEvent,
  CloudSaveAutomaticSyncEvent,
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveV2FileDetails,
  CloudSaveSyncProgressPayload,
  SyncCloudSaveOnGamePageResult,
  SyncGameCloudSaveResult,
  SelectCloudSaveCustomPathResult,
  CloudSaveCustomPathApproval,
  CloudSaveModalSyncResult,
  SelectCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathApprovalResult,
  ConfirmCloudSaveCustomPathRebindApprovalResult,
  LegacySaveExportProgress,
  LegacySaveExportResult,
  SteamSyncState,
  SteamSyncFinishedPayload,
  SteamSyncRunStatus,
  SteamConnectErrorCode,
  ExtractionFailure,
} from "@types";
import type { AxiosProgressEvent } from "axios";

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

  type FileExplorerEntry = {
    name: string;
    path: string;
    isDirectory: boolean;
    isFile: boolean;
    extension: string;
    size: number;
  };

  type FileExplorerPathInfo = {
    exists: boolean;
    isDirectory: boolean;
    isFile: boolean;
  };

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
    setDownloadQueuePosition: (
      shop: GameShop,
      objectId: string,
      targetIndex: number
    ) => Promise<boolean>;
    setPausedDownloadPosition: (
      shop: GameShop,
      objectId: string,
      targetIndex: number
    ) => Promise<boolean>;
    moveDownloadPlacement: (
      shop: GameShop,
      objectId: string,
      targetArea: "hero" | "queue" | "paused",
      targetIndex?: number
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
    getRandomGame: () => Promise<Steam250Game>;
    getGameStats: (objectId: string, shop: GameShop) => Promise<GameStats>;
    getGameAssets: (
      objectId: string,
      shop: GameShop,
      options?: { forceFresh?: boolean }
    ) => Promise<ShopAssets | null>;
    /* Library */
    toggleAutomaticCloudSync: (
      shop: GameShop,
      objectId: string,
      automaticCloudSync: boolean
    ) => Promise<void>;
    setGameHydraPlaytimeEnabled: (
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
    copyCustomGameAsset: (
      sourcePath: string,
      assetType: "icon" | "logo" | "hero" | "grid"
    ) => Promise<string>;
    downloadGameArtwork: (artworkUrl: string) => Promise<string | null>;
    cleanupUnusedAssets: () => Promise<{
      deletedCount: number;
      errors: string[];
    }>;
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
    getGameArtwork: (
      shop: GameShop,
      objectId: string,
      kind: ArtworkKind,
      page?: number
    ) => Promise<ArtworkPage | null>;
    getCoverPoster: (url: string) => Promise<string | null>;
    getGameArtworkSelection: (
      shop: GameShop,
      objectId: string
    ) => Promise<GameArtworkSelection | null>;
    setGameArtworkSelection: (params: {
      shop: GameShop;
      objectId: string;
      type: ArtworkAssetType;
      url?: string;
      artworkId?: number;
      clear?: boolean;
    }) => Promise<GameArtworkSelection | null>;
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
    assignGameToCollection: (
      shop: GameShop,
      objectId: string,
      collectionIds: string[]
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
    updateLaunchOptions: (
      shop: GameShop,
      objectId: string,
      launchOptions: string | null
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
    getCompatibilityDiagnostics: () => Promise<CompatibilityDiagnostic>;
    openLogsFolder: () => Promise<void>;
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
      field: "isHiddenFromOthers" | "isConcealed",
      value: boolean
    ) => Promise<{ isHiddenFromOthers: boolean; isConcealed: boolean }>;
    refreshLibraryAssets: () => Promise<void>;
    getRemoteLibrarySyncState: () => Promise<boolean>;
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
    getGamesRunning: () => Promise<
      Pick<GameRunning, "id" | "sessionDurationInMillis">[]
    >;
    onGamesRunning: (
      cb: (
        gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onLibraryBatchComplete: (cb: () => void) => () => Electron.IpcRenderer;
    onRemoteLibrarySyncStateChange: (
      cb: (syncing: boolean) => void
    ) => () => Electron.IpcRenderer;
    onDownloadsUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    changeGamePlayTime: (
      shop: GameShop,
      objectId: string,
      playtimeInSeconds: number
    ) => Promise<void>;
    resetGamePlayTime: (shop: GameShop, objectId: string) => Promise<void>;
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
    onCompatibilityLaunchFailed: (
      cb: (gameTitle: string) => void
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
    getDownloadSourcesCheckBaseline: () => Promise<string | null>;
    getDownloadSourcesSinceValue: () => Promise<string | null>;

    /* Hardware */
    getDiskFreeSpace: (path: string) => Promise<DiskUsage | null>;
    checkFolderWritePermission: (path: string) => Promise<boolean>;
    getNetworkInterfaces: () => Promise<NetworkInterface[]>;

    /* Cloud save */
    uploadSaveGame: (
      objectId: string,
      shop: GameShop,
      downloadOptionTitle: string | null
    ) => Promise<void>;
    downloadGameArtifact: (
      objectId: string,
      shop: GameShop,
      gameArtifactId: string
    ) => Promise<void>;
    exportGameArtifact: (
      gameArtifactId: string,
      suggestedName: string,
      onProgress?: (progress: LegacySaveExportProgress) => void
    ) => Promise<LegacySaveExportResult>;
    cancelGameArtifactExport: () => Promise<boolean>;
    getGameArtifacts: (
      objectId: string,
      shop: GameShop
    ) => Promise<GameArtifact[]>;
    getGameBackupPreview: (
      objectId: string,
      shop: GameShop
    ) => Promise<LudusaviBackup | null>;
    selectGameBackupPath: (
      shop: GameShop,
      objectId: string,
      backupPath: string | null
    ) => Promise<void>;
    onBackupDownloadComplete: (
      objectId: string,
      shop: GameShop,
      cb: (success: boolean) => void
    ) => () => Electron.IpcRenderer;
    onUploadComplete: (
      objectId: string,
      shop: GameShop,
      cb: () => void
    ) => () => Electron.IpcRenderer;
    onBackupDownloadProgress: (
      objectId: string,
      shop: GameShop,
      cb: (progress: AxiosProgressEvent) => void
    ) => () => Electron.IpcRenderer;

    /* Clipboard */
    clipboard: {
      writeText: (text: string) => Promise<void>;
    };

    /* Misc */
    openExternal: (src: string) => Promise<void>;
    openCheckout: (options?: OpenCheckoutOptions) => Promise<void>;
    getCloudIframeUrl: () => Promise<string>;
    getVersion: () => Promise<string>;
    getAppSessionId: () => Promise<string>;
    isStaging: () => Promise<boolean>;
    ping: () => string;
    getDefaultDownloadsPath: () => Promise<string>;
    openFolder: (folderPath: string) => Promise<string>;
    isPortableVersion: boolean;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    readDirectory: (path: string) => Promise<FileExplorerEntry[]>;
    getPathInfo: (path: string) => Promise<FileExplorerPathInfo>;
    listDrives: () => Promise<string[]>;
    showItemInFolder: (path: string) => Promise<void>;
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
    installHydraDeckyPlugin: () => Promise<{
      success: boolean;
      path: string;
      currentVersion: string | null;
      expectedVersion: string;
      error?: string;
    }>;
    getHydraDeckyPluginInfo: () => Promise<{
      installed: boolean;
      version: string | null;
      path: string;
      outdated: boolean;
      expectedVersion: string | null;
    }>;
    checkHomebrewFolderExists: () => Promise<boolean>;
    onCommonRedistProgress: (
      cb: (value: { log: string; complete: boolean }) => void
    ) => () => Electron.IpcRenderer;
    onPreflightProgress: (
      cb: (value: { status: string; detail: string | null }) => void
    ) => () => Electron.IpcRenderer;
    onGameLauncherStatus: (
      cb: (value: GameLauncherStatusPayload) => void
    ) => () => Electron.IpcRenderer;
    resetCommonRedistPreflight: () => Promise<void>;
    saveTempFile: (fileName: string, fileData: Uint8Array) => Promise<string>;
    deleteTempFile: (filePath: string) => Promise<void>;
    platform: NodeJS.Platform;
    isWayland: boolean;

    /* Auto update */
    onAutoUpdaterEvent: (
      cb: (event: AppUpdaterEvent) => void
    ) => () => Electron.IpcRenderer;
    checkForUpdates: () => Promise<boolean>;
    restartAndInstallUpdate: () => Promise<void>;

    /* Auth */
    getAuth: () => Promise<Auth | null>;
    signOut: () => Promise<void>;
    openAuthWindow: (page: AuthPage) => Promise<void>;
    startGoogleAuth: () => Promise<{ linked: true }>;
    disconnectGoogleDrive: () => Promise<{ ok: boolean }>;
    getGoogleDriveStatus: () => Promise<GoogleDriveCloudStatus>;
    minimizeAuthWindow: () => Promise<void>;
    closeAuthWindow: () => Promise<void>;
    getSessionHash: () => Promise<string | null>;
    onSignIn: (cb: () => void) => () => Electron.IpcRenderer;
    onAccountUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    onSteamConnected: (cb: () => void) => () => Electron.IpcRenderer;
    onSteamConnectError: (
      cb: (code: SteamConnectErrorCode) => void
    ) => () => Electron.IpcRenderer;
    onSignOut: (cb: () => void) => () => Electron.IpcRenderer;

    startSteamOAuth: (lng: string) => Promise<void>;
    disconnectSteam: (deleteImportedData: boolean) => Promise<void>;
    startSteamSync: () => Promise<SteamSyncState>;
    cancelSteamSync: () => Promise<void>;
    getSteamSyncState: () => Promise<SteamSyncState>;
    syncSteamGameOnGamePage: (steamAppId: string) => Promise<boolean>;
    reconcileSteamSyncRun: (
      latestSyncRunStatus: SteamSyncRunStatus | null
    ) => Promise<void>;
    onSteamSyncProgress: (
      cb: (state: SteamSyncState) => void
    ) => () => Electron.IpcRenderer;
    onSteamSyncFinished: (
      cb: (payload: SteamSyncFinishedPayload) => void
    ) => () => Electron.IpcRenderer;

    /* Profile */
    getMe: () => Promise<UserDetails | null>;
    updateProfile: (
      updateProfile: UpdateProfileRequest
    ) => Promise<UserProfile>;
    updateProfile: (updateProfile: UpdateProfileProps) => Promise<UserProfile>;
    getProfileImageMetadata: (
      path: string
    ) => Promise<{ mimeType: string | null; isAnimated: boolean }>;
    processProfileImage: (
      path: string
    ) => Promise<{ imagePath: string; mimeType: string }>;
    cropProfileImage: (
      path: string,
      params: {
        left: number;
        top: number;
        width: number;
        height: number;
        outputWidth: number;
        outputHeight: number;
        rotation?: number;
      }
    ) => Promise<{ imagePath: string }>;
    onSyncNotificationCount: (
      cb: (notification: NotificationSync) => void
    ) => () => Electron.IpcRenderer;
    onCloudGiftResolved: (
      cb: (giftId: string) => void
    ) => () => Electron.IpcRenderer;
    notifyCloudGiftResolved: (giftId: string) => Promise<void>;

    /* Notifications */
    publishNewRepacksNotification: (newRepacksCount: number) => Promise<void>;
    getLocalNotifications: () => Promise<LocalNotification[]>;
    getLocalNotificationsCount: () => Promise<number>;
    markLocalNotificationRead: (id: string) => Promise<void>;
    markLocalNotificationUnread: (id: string) => Promise<void>;
    markAllLocalNotificationsRead: () => Promise<void>;
    deleteLocalNotification: (id: string) => Promise<void>;
    clearAllLocalNotifications: () => Promise<void>;
    onLocalNotificationCreated: (
      cb: (notification: LocalNotification) => void
    ) => () => Electron.IpcRenderer;
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
