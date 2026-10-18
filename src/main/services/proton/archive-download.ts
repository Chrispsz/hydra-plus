import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { createInactivityWatchdog } from "./inactivity-watchdog";

/**
 * Streams a release archive to disk with:
 * - a 30s timeout for the response headers (redirect hops included);
 * - a 90s inactivity watchdog rearmed on every progress event;
 * - cancellation through the caller's AbortSignal;
 * - partial-file cleanup on any failure path.
 *
 * Kept free of Electron imports (the user agent is provided by the
 * caller) so the download path stays unit-testable.
 */

const DOWNLOAD_HEADERS_TIMEOUT_MS = 30_000;
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 90_000;

type DownloadAbortCause = "canceled" | "stalled" | "headers_timeout";

export interface DownloadProtonArchiveOptions {
  url: string;
  destinationPath: string;
  signal: AbortSignal;
  userAgent: string;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

const isCanceledError = (error: unknown): boolean =>
  axios.isAxiosError(error) &&
  (error.code === "ERR_CANCELED" || error.code === "ECANCELED");

export const downloadProtonArchive = async (
  options: DownloadProtonArchiveOptions
): Promise<void> => {
  const controller = new AbortController();
  let abortCause: DownloadAbortCause | null = null;

  const externalAbortListener = () => {
    if (!abortCause) abortCause = "canceled";
    controller.abort();
  };
  options.signal.addEventListener("abort", externalAbortListener, {
    once: true,
  });

  const watchdog = createInactivityWatchdog({
    timeoutMs: DOWNLOAD_INACTIVITY_TIMEOUT_MS,
    onTimeout: () => {
      if (!abortCause) abortCause = "stalled";
      controller.abort();
    },
  });

  let headersTimer: NodeJS.Timeout | null = setTimeout(() => {
    if (!abortCause) abortCause = "headers_timeout";
    controller.abort();
  }, DOWNLOAD_HEADERS_TIMEOUT_MS);

  const removePartialFile = async () => {
    await fs.promises.rm(options.destinationPath, { force: true }).catch(() => {
      // Best-effort cleanup only.
    });
  };

  try {
    let response;
    try {
      response = await axios.get<NodeJS.ReadableStream>(options.url, {
        responseType: "stream",
        signal: controller.signal,
        headers: { "User-Agent": options.userAgent },
        onDownloadProgress: (event) => {
          watchdog.reset();
          if (!options.onProgress) return;

          const totalBytes =
            typeof event.total === "number" && event.total > 0
              ? event.total
              : null;
          options.onProgress(event.loaded, totalBytes);
        },
      });
    } finally {
      if (headersTimer) clearTimeout(headersTimer);
      headersTimer = null;
    }

    if (options.signal.aborted) {
      throw new Error("canceled");
    }

    await fs.promises.mkdir(path.dirname(options.destinationPath), {
      recursive: true,
    });

    await pipeline(
      response.data as NodeJS.ReadableStream,
      fs.createWriteStream(options.destinationPath)
    );
  } catch (error) {
    await removePartialFile();

    if (abortCause) {
      throw new Error(`proton_download_${abortCause}`, { cause: error });
    }

    if (isCanceledError(error)) {
      throw new Error("canceled", { cause: error });
    }

    throw new Error("proton_download_failed", { cause: error });
  } finally {
    watchdog.clear();
    if (headersTimer) clearTimeout(headersTimer);
    options.signal.removeEventListener("abort", externalAbortListener);
  }
};
