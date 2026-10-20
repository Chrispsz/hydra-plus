import { Downloader } from "@shared/constants";
import type { Download, DownloadStatus } from "@types";

/**
 * Ghost-download guards (F1 stability fix), extracted verbatim from
 * game-files-manager.ts: registry rewrites during and after extraction
 * re-read the record first, so a download removed mid-extraction stays
 * removed instead of coming back as a ghost entry.
 */

/**
 * A download cancelled/removed while its extraction was running:
 * rewriting its registry entry would resurrect it in the list.
 */
export const shouldSkipRegistryRewrite = (
  download: Download | undefined
): boolean => !download || download.status === "removed";

/**
 * The mid-extraction rewrite runs after a long extraction: the record
 * may have been removed (or its registry entry purged) meanwhile —
 * abort instead of resurrecting it with stale data.
 */
export const shouldAbortProgressRewrite = (
  currentDownload: Download | undefined
): boolean => !currentDownload || currentDownload.status === "removed";

/**
 * The status a download returns to when its extraction pipeline ends
 * without a completion: seeding when a finished torrent should keep
 * seeding, complete when fully downloaded, its previous status
 * otherwise.
 */
export const resolveResetStatus = (
  download: Download
): DownloadStatus | null =>
  download.progress === 1
    ? download.shouldSeed && download.downloader === Downloader.Torrent
      ? "seeding"
      : "complete"
    : download.status;
