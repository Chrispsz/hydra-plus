import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Archive extraction through the system `tar` (or `unzip` for zip
 * assets) with no shell involved. A directory-activity watchdog kills
 * the child when the staging directory stops growing, so a hung
 * extractor can never wedge the install job forever.
 *
 * Linux-only by design: Proton builds are only managed on Linux.
 */

const EXTRACTION_INACTIVITY_TIMEOUT_MS = 90_000;
const EXTRACTION_POLL_INTERVAL_MS = 5_000;
/** Beyond this many entries the walk gives up and inactivity never fires. */
const EXTRACTION_WATCH_ENTRY_CAP = 200_000;
const STDERR_CAPTURE_LIMIT_BYTES = 4_096;

const isTarArchive = (archivePath: string): boolean =>
  /\.(tar|tar\.gz|tgz|tar\.xz|txz)$/i.test(archivePath);

const isZipArchive = (archivePath: string): boolean =>
  /\.zip$/i.test(archivePath);

interface DirectorySignature {
  entries: number;
  totalBytes: number;
  capped: boolean;
}

const walkDirectorySignature = async (
  dirPath: string
): Promise<DirectorySignature> => {
  let entries = 0;
  let totalBytes = 0;
  let capped = false;

  const stack: string[] = [dirPath];

  while (stack.length > 0) {
    const currentDir = stack.pop() as string;
    let dirents: fs.Dirent[] = [];

    try {
      dirents = await fs.promises.readdir(currentDir, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      entries += 1;
      if (entries > EXTRACTION_WATCH_ENTRY_CAP) {
        capped = true;
        break;
      }

      const entryPath = path.join(currentDir, dirent.name);

      if (dirent.isDirectory()) {
        stack.push(entryPath);
      } else if (dirent.isFile()) {
        try {
          totalBytes += (await fs.promises.stat(entryPath)).size;
        } catch {
          // File vanished mid-walk (extraction in progress): ignore.
        }
      }
    }

    if (capped) break;
  }

  return { entries, totalBytes, capped };
};

const createDirectoryActivityWatchdog = (options: {
  dirPath: string;
  onInactive: () => void;
}): { clear: () => void } => {
  let lastSignature: DirectorySignature | null = null;
  let lastChangeAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;

    try {
      const signature = await walkDirectorySignature(options.dirPath);

      if (
        lastSignature === null ||
        signature.entries !== lastSignature.entries ||
        signature.totalBytes !== lastSignature.totalBytes
      ) {
        lastSignature = signature;
        lastChangeAt = Date.now();
      } else if (
        !signature.capped &&
        Date.now() - lastChangeAt >= EXTRACTION_INACTIVITY_TIMEOUT_MS
      ) {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
        options.onInactive();
        return;
      }
    } catch {
      lastChangeAt = Date.now();
    }

    if (!stopped) {
      timer = setTimeout(() => void tick(), EXTRACTION_POLL_INTERVAL_MS);
    }
  };

  timer = setTimeout(() => void tick(), EXTRACTION_POLL_INTERVAL_MS);

  return {
    clear: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};

export interface ExtractProtonArchiveOptions {
  archivePath: string;
  destinationDir: string;
  signal: AbortSignal;
}

const runExtractor = (options: {
  command: string;
  args: string[];
  destinationDir: string;
  signal: AbortSignal;
}): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    let stderr = "";
    let settled = false;

    const child = spawn(options.command, options.args, {
      shell: false,
      signal: options.signal,
    });

    const watchdog = createDirectoryActivityWatchdog({
      dirPath: options.destinationDir,
      onInactive: () => child.kill("SIGKILL"),
    });

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      watchdog.clear();
      callback();
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_CAPTURE_LIMIT_BYTES) {
        stderr += chunk.toString("utf8");
      }
    });

    child.once("error", (error) => {
      settle(() => {
        reject(new Error(`proton_extraction_failed:${error.message}`));
      });
    });

    child.once("close", (code, closeSignal) => {
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }

        if (closeSignal === "SIGTERM" || closeSignal === "SIGKILL") {
          reject(
            new Error(`proton_extraction_aborted:${closeSignal}`, {
              cause: stderr.trim().slice(-256),
            })
          );
          return;
        }

        const detail =
          stderr.trim().split("\n").pop()?.slice(0, 200) ||
          `exit code ${code ?? "null"}`;
        reject(new Error(`proton_extraction_failed:${detail}`));
      });
    });
  });
};

export const extractProtonArchive = async (
  options: ExtractProtonArchiveOptions
): Promise<void> => {
  const { archivePath, destinationDir, signal } = options;

  if (isTarArchive(archivePath)) {
    // `tar -xf` auto-detects gzip/xz compression from the archive.
    return runExtractor({
      command: "tar",
      args: ["-xf", archivePath, "-C", destinationDir],
      destinationDir,
      signal,
    });
  }

  if (isZipArchive(archivePath)) {
    return runExtractor({
      command: "unzip",
      args: ["-q", "-o", archivePath, "-d", destinationDir],
      destinationDir,
      signal,
    });
  }

  throw new Error("proton_extraction_unsupported_archive");
};
