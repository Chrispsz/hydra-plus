import type { DownloadSourceStatus, Downloader } from "@shared";
import type { SteamAppDetails } from "./steam.types";
import type { Download, Game, Subscription } from "./level.types";
import type { GameShop } from "./game.types";
import type { ArtworkAssetType } from "./artwork.types";

export * from "./download-contract";

export interface DiskUsage {
  free: number;
  total: number;
}

export interface GameRepack {
  id: string;
  title: string;
  fileSize: string | null;
  uris: string[];
  unavailableUris: string[];
  uploadDate: string | null;
  downloadSourceId: string;
  downloadSourceName: string;
  createdAt: string;
}

export interface DownloadSource {
  id: string;
  name: string;
  url: string;
  status: DownloadSourceStatus;
  downloadCount: number;
  fingerprint?: string;
  isRemote?: true;
  createdAt: string;
}

export interface ProtonVersion {
  name: string;
  path: string;
  source?: "steam" | "compatibility_tools" | "unknown";
}

/** Downloadable Proton build source (GitHub releases registry entry). */
export interface ProtonProvider {
  id: string;
  name: string;
  repo: string;
  description?: string;
}

/** A downloadable Proton release asset resolved from a provider. */
export interface ProtonRelease {
  tag: string;
  name: string;
  publishedAt: string;
  sizeBytes: number;
  downloadUrl: string;
  digest?: string;
}

/** A compatibilitytools.d root where Proton builds can be installed. */
export interface ProtonInstallTarget {
  path: string;
  label: string;
  isDefault: boolean;
}

export type ProtonInstallPhase =
  | "downloading"
  | "verifying"
  | "extracting"
  | "promoting"
  | "done"
  | "error";

export interface ProtonInstallProgress {
  providerId: string;
  tag: string;
  phase: ProtonInstallPhase;
  receivedBytes?: number;
  totalBytes?: number;
  error?: string;
}

export interface ShopAssets {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
  logoPosition: string | null;
  coverImageUrl: string | null;
  downloadSources: string[];
  selectedArtworkTypes?: ArtworkAssetType[];
}

/**
 * Lean Hydra account profile (sign in restores catalogue/source sync;
 * there is no social layer anymore).
 */
export interface UserDetails {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl?: string | null;
  subscription?: Subscription | null;
}

export type ShopDetails = SteamAppDetails & {
  objectId: string;
  platform?: string;
  skus?: string[];
  descriptionLanguage?: string;
};

export type ShopDetailsWithAssets = ShopDetails & {
  assets: ShopAssets | null;
};

export interface TorrentFile {
  index: number;
  path: string;
  length: number;
}

export interface TorrentFilesResponse {
  infoHash: string;
  name: string;
  totalSize: number;
  files: TorrentFile[];
}

export type UserGame = {
  objectId: string;
  shop: GameShop;
  title: string;
  playTimeInSeconds: number;
  lastTimePlayed: Date | null;
  hasManuallyUpdatedPlaytime: boolean;
  hasActiveSteamImport?: boolean;
  isFavorite: boolean;
  isConcealed?: boolean;
  isPinned: boolean;
  pinnedDate?: Date | null;
  customLibraryImageUrl?: string | null;
  customLibraryHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  customIconUrl?: string | null;
} & ShopAssets;

export interface UserLibraryResponse {
  totalCount: number;
  library: UserGame[];
  pinnedGames: UserGame[];
}

export interface GameRunning {
  id: string;
  title: string;
  iconUrl: string | null;
  customIconUrl?: string | null;
  coverImageUrl?: string | null;
  objectId: string;
  shop: GameShop;
  sessionDurationInMillis: number;
}

export interface SteamGame {
  id: number;
  name: string;
  clientIcon: string | null;
}

export type AppUpdaterEvent =
  | { type: "update-available"; info: { version: string } }
  | { type: "update-downloaded" };

/* Events */
export interface StartGameDownloadPayload {
  objectId: string;
  title: string;
  shop: GameShop;
  uri: string;
  downloadPath: string;
  downloader: Downloader;
  automaticallyExtract: boolean;
  automaticallyDeleteArchiveFiles: boolean;
  fileSize?: string | null;
  fileIndices?: number[];
  selectedFilesSize?: number | null;
}

export interface DownloadSourceDownload {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
}

export interface GameStats {
  downloadCount: number;
  playerCount: number;
  averageScore: number | null;
  reviewCount: number;
}

export interface GameReviewAnswer {
  id: string;
  answerHtml: string;
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  downvotes: number;
  isBlocked: boolean;
  hasUpvoted: boolean;
  hasDownvoted: boolean;
  user: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
    backgroundImageUrl?: string | null;
  };
  translations: {
    [key: string]: string;
  };
  detectedLanguage: string | null;
}

export interface GameReview {
  id: string;
  reviewHtml: string;
  score: number;
  createdAt: string;
  updatedAt: string;
  upvotes: number;
  downvotes: number;
  answerCount: number;
  answers: GameReviewAnswer[];
  isBlocked: boolean;
  hasUpvoted: boolean;
  hasDownvoted: boolean;
  playTimeInSeconds?: number;
  user: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
    backgroundImageUrl?: string | null;
  };
  translations: {
    [key: string]: string;
  };
  detectedLanguage: string | null;
}

export interface TrendingGame extends ShopAssets {
  description: string | null;
  uri: string;
}

export interface UserStatsPercentile {
  value: number;
  topPercentile: number;
}

export interface UserStats {
  libraryCount: number;
  totalPlayTimeInSeconds: UserStatsPercentile;
}

export type GameLauncherStatus = "complete";

export interface GameLauncherStatusPayload {
  gameKey: string;
  status: GameLauncherStatus;
  detail: string | null;
}

export interface GameArtifact {
  id: string;
  artifactLengthInBytes: number;
  downloadOptionTitle: string | null;
  createdAt: string;
  updatedAt: string;
  hostname: string;
  downloadCount: number;
  label?: string;
  isFrozen: boolean;
}

export type LegacySaveExportResult =
  | { status: "saved"; filePath: string }
  | { status: "cancelled" }
  | { status: "busy" };

export interface LegacySaveExportProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
}

export interface LegacySaveExportIpcProgress extends LegacySaveExportProgress {
  operationId: string;
}

export interface CatalogueSearchPayload {
  title: string;
  sortBy:
    | "popularity"
    | "reviewScore"
    | "alphabetical"
    | "hydraScore"
    | "releaseDate";
  sortOrder: "asc" | "desc";
  downloadSourceFingerprints: string[];
  tags: number[];
  publishers: string[];
  genres: string[];
  developers: string[];
  protondbSupportBadges: (
    | "borked"
    | "bronze"
    | "silver"
    | "gold"
    | "platinum"
  )[];
  deckCompatibility: ("verified" | "playable" | "unsupported" | "unknown")[];
  releaseYear?: { gte?: number; lte?: number };
  shops?: string[];
  platforms?: string[];
}

export interface ProtonDBData {
  tier: string | null;
  confidence: string | null;
  score: number | null;
  total: number | null;
  trendingTier: string | null;
  resolvedCategory: number | null;
  deckCompatibility: "verified" | "playable" | "unsupported" | "unknown" | null;
}

export type CatalogueSearchResult = {
  id: string;
  objectId: string;
  title: string;
  shop: GameShop;
  genres: string[];
  releaseYear: number | null;
  tier?: string | null;
  bestReportedTier?: string | null;
  protondbSupportBadge?: string | null;
  protondbSupportBadges?: string[];
  deckCompatibility?: string | null;
  deckCompatibilities?: string[];
  platform?: string;
  alternateNames?: string[];
  developers?: string[];
  publishers?: string[];
  skus?: string[];
} & Pick<ShopAssets, "libraryImageUrl" | "downloadSources">;

export type LibraryGame = Game &
  Partial<ShopAssets> & {
    id: string;
    download: Download | null;
  };

export type UserGameDetails = ShopAssets & {
  id: string;
  playTimeInSeconds: number;
  lastTimePlayed: Date | null;
  isDeleted: boolean;
  isFavorite: boolean;
};

export * from "./game.types";
export * from "./external-games.types";
export * from "./steam.types";
export * from "./steam-integration.types";
export * from "./download.types";
export * from "./ludusavi.types";
export * from "./how-long-to-beat.types";
export * from "./level.types";
export * from "./artwork.types";
export * from "./cloud-save.types";

export type ExtractionFailure =
  | { reason: "unsupported-format"; format: string }
  | { reason: "file-not-found" };
