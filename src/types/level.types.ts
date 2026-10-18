import type { Downloader } from "@shared";
import type { GameShop } from "./game.types";
import type { DownloadStatus } from "./download.types";

/*
 * LaunchBox "classics" discs. `discs` / `selectedDiscPath` are still live:
 * game shortcuts (Steam + desktop), delete-game-folder and the library UI pick
 * which disc launches.
 */
export interface ClassicsDisc {
  path: string;
  label: string;
  fileName: string;
  sku?: string | null;
}

export type SubscriptionStatus = "active" | "pending" | "cancelled";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  plan: { id: string; name: string };
  expiresAt: string | null;
  paymentMethod: "pix" | "paypal";
}

export interface Auth {
  accessToken: string;
  refreshToken: string;
  tokenExpirationTimestamp: number;
}

export interface User {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  subscription: Subscription | null;
}

export interface Game {
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  customCoverImageUrl?: string | null;
  originalIconPath?: string | null;
  originalLogoPath?: string | null;
  originalHeroPath?: string | null;
  customOriginalIconPath?: string | null;
  customOriginalLogoPath?: string | null;
  customOriginalHeroPath?: string | null;
  customOriginalCoverPath?: string | null;
  playTimeInMilliseconds: number;
  steamPlayTimeInMilliseconds?: number;
  hasActiveSteamImport?: boolean;
  enableHydraPlaytimeTracking?: boolean;
  /**
   * Online (Online-Fix) mode: launches the game with the Steam client
   * guaranteed to be running and Wine DLL overrides that keep the Steam
   * networking/overlay path native (Spacewar relay), following the same
   * approach as dedicated online-fix launchers on Linux.
   */
  onlineFixEnabled?: boolean;
  unsyncedDeltaPlayTimeInMilliseconds?: number;
  lastTimePlayed: Date | null;
  addedToLibraryAt?: Date | null;
  objectId: string;
  shop: GameShop;
  remoteId: string | null;
  source?: "hydra" | "steam";
  isDeleted: boolean;
  winePrefixPath?: string | null;
  protonPath?: string | null;
  executablePath?: string | null;
  executablePathUpdatedAt?: Date | null;
  trackingExecutablePaths?: string[] | null;
  trackingExecutablePathsUpdatedAt?: Date | null;
  launchOptions?: string | null;
  /**
   * Catalog launch flag ids (see `@shared/launch-flags`) applied on the
   * Linux compatibility path (umu-run / direct Proton) at launch time.
   * Free-text `launchOptions` still wins over flag env assignments.
   */
  launchFlags?: string[] | null;
  autoRunMangohud?: boolean | null;
  autoRunGamemode?: boolean | null;
  favorite?: boolean;
  isConcealed?: boolean;
  isPinned?: boolean;
  pinnedDate?: Date | null;
  automaticCloudSync?: boolean;
  hasManuallyUpdatedPlaytime?: boolean;
  newDownloadOptionsCount?: number;
  installedSizeInBytes?: number | null;
  installerSizeInBytes?: number | null;
  steamShortcutAppId?: number;
  platform?: string | null;
  discs?: ClassicsDisc[];
  selectedDiscPath?: string | null;
  dontAskDiscSelection?: boolean;
  romSizeBytes?: number | null;
}

export interface DownloadFile {
  index: number;
  path: string;
  size: number;
  bytesDownloaded: number;
  completed: boolean;
}

export interface Download {
  shop: GameShop;
  objectId: string;
  uri: string;
  folderName: string | null;
  downloadPath: string;
  progress: number;
  downloader: Downloader;
  bytesDownloaded: number;
  fileSize: number | null;
  shouldSeed: boolean;
  status: DownloadStatus | null;
  queued: boolean;
  pinnedToHero?: boolean;
  timestamp: number;
  extracting: boolean;
  extractionProgress?: number;
  automaticallyExtract: boolean;
  automaticallyDeleteArchiveFiles: boolean;
  fileIndices?: number[];
  files?: DownloadFile[];
  selectedFilesSize?: number | null;
  realDebridTorrentId?: string;
  awaitingDebrid?: boolean;
  debridAutoResume?: boolean;
  debridQueueOnly?: boolean;
  debridQueuePosition?: number;
  debridPreparationDeadline?: number;
  customTrackers?: string[];
}

export interface DownloadLayoutState {
  version: 1;
  queueOrder: string[];
  pausedOrder: string[];
}

export interface DownloadDirectoryPreference {
  path: string;
  createdAt: string;
  source: "manual" | "auto";
}

export interface PortableReleaseInfo {
  version: string;
  downloadUrl: string;
  sizeBytes: number;
}

export interface UserPreferences {
  /**
   * Self-serve Google OAuth "Desktop app" client used to link the user's
   * Drive when the build shipped without MAIN_VITE_GOOGLE_CLIENT_ID.
   * For desktop clients the secret is public data (PKCE protects the flow).
   */
  googleDriveClientId?: string;
  googleDriveClientSecret?: string;
  /**
   * How many snapshot versions to keep per game on Google Drive before the
   * oldest ones are pruned. Default: 20.
   */
  cloudSaveSnapshotRetention?: number;
  /**
   * Interval (minutes) for the bidirectional background auto-sync of games
   * that are not running. 0 disables it. Default: 30.
   */
  cloudSavePeriodicSyncMinutes?: number;
  downloadsPath?: string | null;
  defaultWinePrefixPath?: string | null;
  downloadDirectories?: DownloadDirectoryPreference[];
  optionalDownloadsPaths?: string[];
  ggDealsApiKey?: string | null;
  language?: string;
  realDebridApiToken?: string | null;
  premiumizeApiToken?: string | null;
  allDebridApiToken?: string | null;
  torBoxApiToken?: string | null;
  preferQuitInsteadOfHiding?: boolean;
  runAtStartup?: boolean;
  startMinimized?: boolean;
  launchToLibraryPage?: boolean;
  disableNsfwAlert?: boolean;
  enableAutoInstall?: boolean;
  seedAfterDownloadComplete?: boolean;
  showDownloadSpeedInMegabits?: boolean;
  showDownloadSpeedInMegabytes?: boolean;
  extractFilesByDefault?: boolean;
  deleteArchiveFilesAfterExtractionByDefault?: boolean;
  autoplayGameTrailers?: boolean;
  hideToTrayOnGameStart?: boolean;
  enableNewDownloadOptionsBadges?: boolean;
  createStartMenuShortcut?: boolean;
  maxDownloadSpeedBytesPerSecond?: number | null;
  torrentNetworkInterface?: string | null;
  globalTrackers?: string[];
  appendGlobalTrackers?: boolean;
  globalTrackersUrl?: string;
  appendGlobalTrackersUrl?: boolean;
  defaultProtonPath?: string | null;
  autoRunMangohud?: boolean;
  autoRunGamemode?: boolean;
  hideLibraryGameBadges?: boolean;
  hideLibraryReadySizeBadges?: boolean;
  hideSteamLibraryBadges?: boolean;
  autoplayAnimatedArtwork?: boolean;
  persistFiltersAndSorting?: boolean;
}

export interface NetworkInterface {
  name: string;
  addresses: string[];
}

export interface ScreenState {
  x?: number;
  y?: number;
  height: number;
  width: number;
  isMaximized: boolean;
}
