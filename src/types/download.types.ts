import type { Download } from "./level.types";

export type DownloadStatus =
  | "active"
  // Legacy/raw compatibility only. Not part of the official product contract.
  | "waiting"
  | "paused"
  | "error"
  | "complete"
  | "seeding"
  | "removed"
  // Legacy/raw compatibility only. Official extraction state is the flag on Download.
  | "extracting";

export interface DownloadProgress {
  downloadSpeed: number;
  timeRemaining: number;
  numPeers: number;
  numSeeds: number;
  isDownloadingMetadata: boolean;
  isCheckingFiles: boolean;
  isReconnecting?: boolean;
  isRecovering?: boolean;
  recoveryProgress?: number;
  progress: number;
  gameId: string;
  download: Download;
}

/* Torrent */
export interface SeedingStatus {
  gameId: string;
  status: DownloadStatus;
  uploadSpeed: number;
}
