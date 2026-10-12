import { execFile, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

import { logger } from "./logger";
import { logsPath } from "@main/constants";
import {
  ONLINE_FIX_MIRROR_MAX_FILE_BYTES,
  ONLINE_FIX_PAYLOAD_DIRECTORIES,
  ONLINE_FIX_PAYLOAD_FILES,
  buildOnlineFixDllOverrides,
  buildOnlineFixSteamContextEnv,
  buildSteamRuntimeCandidatePaths,
  buildWindowsOnlineFixPath,
  findOnlineFixMarkerDlls,
  resolveSteamInstallKind,
  sanitizeOnlineFixIni,
} from "./online-fix-core";
import { getSteamLibraryFolders } from "./steam";

const execFileAsync = promisify(execFile);

/**
 * Online (Online-Fix) launch session — cross-platform.
 *
 * Online-Fix patches use the user's real Steam client for multiplayer —
 * the "Spacewar" (appid 480) relay shows up in the Steam UI while the
 * game's own patched steam_api drives the lobbies. Dedicated community
 * launchers (SOFL, OFLL) all follow the same recipe, which this service
 * mirrors on both platforms:
 *
 * 1. make sure the Steam client is running and signed in before launch
 *    (Windows: resolved from the registry / standard install paths;
 *    Linux: `steam` on the PATH);
 * 2. on Wine/Proton sessions, load the game's OWN DLLs natively — the
 *    executable folder AND the game root are scanned and every shipped
 *    DLL gets a "native,builtin" override (`=n,b`), so the fix's payload
 *    DLLs (OnlineFix64, SteamOverlay64, dnet, steam_api64, proxy DLLs
 *    like winmm/dinput8) shadow Wine's built-ins exactly as on Windows.
 *    STRICT `=n` overrides are never emitted: the Wine loader
 *    (dlls/ntdll/unix/loader.c, map_pe_file) rejects built-in-resolving
 *    files under a strict native override with STATUS_DLL_NOT_FOUND —
 *    the recurring "error 126". `=n,b` is strictly dominant.
 * 3. on Wine/Proton sessions the Steam overlay is injected the way OFLL
 *    does it: LD_PRELOAD the native gameoverlayrenderer.so (32+64) from
 *    the Steam client install plus SteamOverlayGameId (from the fix's
 *    onlinefix.ini FakeAppId when present, otherwise 480), so the fix
 *    finds an overlay to hook instead of failing with "error 126";
 * 4. the patch payload is MIRRORED next to the game executable (fix
 *    packages ship it at the game root while Unreal-style exes live in
 *    Binaries/Win64 — the loader then cannot find its payload and dies
 *    with error 126), and onlinefix.ini gets OFLL's ExtraProtection
 *    hygiene; on first online launch per prefix the VC++ 2015-2022
 *    runtime is seeded via `umu-run winetricks vcrun2022` — the classic
 *    missing dependency behind 126 when the prefix only has Wine's
 *    built-in runtimes;
 * 5. keep Wine quiet but NOT blind: WINEDEBUG=+err so the actual
 *    failing import (`err:module`) lands in umu.log and the Online tab
 *    can name the missing DLL instead of a bare "error 126";
 * 6. on Windows the game folder is prepended to PATH and the game is
 *    always spawned directly with the game folder as working directory —
 *    the patch loader resolves its payload relative to it.
 */

const STEAM_WAIT_TIMEOUT_MS = 45_000;
const STEAM_POLL_INTERVAL_MS = 1_000;

const listDllNames = (directory: string): string[] => {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => path.extname(name).toLowerCase() === ".dll");
  } catch {
    return [];
  }
};

/**
 * Collects the DLL file names an Online-Fix patch may rely on: the
 * executable's folder first, then the game root above it (repacks ship
 * the fix payload at the root while executables often live in
 * Binaries/Win64-style subfolders).
 */
export const collectOnlineFixDllNames = (
  executableDirectory: string
): string[] => {
  const names = new Set<string>();

  listDllNames(executableDirectory).forEach((name) => names.add(name));

  const parentDirectory = path.dirname(executableDirectory);
  if (parentDirectory && parentDirectory !== executableDirectory) {
    listDllNames(parentDirectory).forEach((name) => {
      if (!names.has(name)) names.add(name);
    });
  }

  return Array.from(names);
};

/**
 * Wine env for online sessions (Steam context + game DLLs + Steam
 * overlay injection, quiet-but-diagnosable logs). Linux only.
 *
 * The Steam context is the part umu cannot provide: umu-run blanks
 * STEAM_COMPAT_CLIENT_INSTALL_PATH and forces SteamAppId=0, which
 * disconnects the fix's steam_api from the running client — the
 * persistent "steam overlay dll error 126". This env therefore pins the
 * Spacewar relay (480), joins the overlay to the fix's session and
 * enables the Vulkan overlay layer (OFLL recipe); the launch itself
 * goes through direct Proton with the Steam Linux Runtime wrap (see
 * launch-game.ts), exactly like the community launchers do it.
 */
export const getOnlineFixLaunchEnv = (
  gameDir: string,
  overlayGameId?: string | null
): Record<string, string> => {
  const env: Record<string, string> = {
    WINEDLLOVERRIDES: buildOnlineFixDllOverrides(
      collectOnlineFixDllNames(gameDir)
    ),
    WINEDEBUG: "+err",
    ...buildOnlineFixSteamContextEnv(overlayGameId),
  };

  const overlayPreload = buildSteamOverlayPreload(getSteamClientRoot());
  if (overlayPreload) {
    env.LD_PRELOAD = overlayPreload;
  }

  return env;
};

/**
 * Windows env for online sessions: the game folder must be on PATH so
 * the patch's payload DLLs resolve by name regardless of the working
 * directory the game is spawned with, plus the Spacewar Steam context
 * (the fix relays through the running client).
 */
export const getWindowsOnlineFixLaunchEnv = (
  gameDir: string,
  overlayGameId?: string | null
): Record<string, string> => ({
  PATH: buildWindowsOnlineFixPath(gameDir, process.env.PATH ?? ""),
  ...buildOnlineFixSteamContextEnv(overlayGameId),
});

// ---------------------------------------------------------------------------
// Steam overlay injection (Linux, OFLL recipe)
// ---------------------------------------------------------------------------

export const STEAM_OVERLAY_GAME_ID = "480";

const STEAM_BASE_DIRECTORIES = (
  [
    [".steam", "steam"],
    [".steam", "root"],
    [".local", "share", "Steam"],
    [".var", "app", "com.valvesoftware.Steam", "data", "Steam"],
    [".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"],
    ["snap", "steam", "common", ".local", "share", "Steam"],
  ] as const
).map((segments) => path.join(process.env.HOME ?? "", ...segments));

const OVERLAY_LIB_RELATIVE_PATHS = [
  path.join("ubuntu12_32", "gameoverlayrenderer.so"),
  path.join("ubuntu12_64", "gameoverlayrenderer.so"),
];

/**
 * Resolves the REAL Steam client root for the detected install kind.
 * Returns null when no client root exists on this machine.
 */
export const getSteamClientRoot = (): string | null => {
  const home = process.env.HOME ?? "";
  const kind = detectSteamInstallKind();

  const candidatesByKind: Record<string, string[]> = {
    native: [
      path.join(home, ".steam", "steam"),
      path.join(home, ".local", "share", "Steam"),
    ],
    flatpak: [
      path.join(
        home,
        ".var",
        "app",
        "com.valvesoftware.Steam",
        "data",
        "Steam"
      ),
      path.join(
        home,
        ".var",
        "app",
        "com.valvesoftware.Steam",
        ".local",
        "share",
        "Steam"
      ),
    ],
    snap: [
      path.join(home, "snap", "steam", "common", ".local", "share", "Steam"),
    ],
  };

  const candidates =
    kind === "unknown"
      ? STEAM_BASE_DIRECTORIES
      : (candidatesByKind[kind] ?? STEAM_BASE_DIRECTORIES);

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // Unreadable location — try the next one.
    }
  }

  return null;
};

/**
 * Builds the LD_PRELOAD value pointing at the native Steam overlay
 * renderer (32+64 bit) of the given client root (falls back to the
 * known Steam base directories). Returns null — and leaves the env
 * untouched — when no overlay library exists, so non-Steam setups
 * launch exactly as before.
 */
export const buildSteamOverlayPreload = (
  steamRoot?: string | null
): string | null => {
  const overlayPaths: string[] = [];
  const baseDirectories = steamRoot
    ? [steamRoot, ...STEAM_BASE_DIRECTORIES]
    : STEAM_BASE_DIRECTORIES;

  for (const steamBase of baseDirectories) {
    if (!steamBase) continue;

    for (const relativePath of OVERLAY_LIB_RELATIVE_PATHS) {
      const overlayPath = path.join(steamBase, relativePath);
      try {
        if (fs.existsSync(overlayPath) && !overlayPaths.includes(overlayPath)) {
          overlayPaths.push(overlayPath);
        }
      } catch {
        // Unreadable location — skip this candidate.
      }
    }
  }

  if (overlayPaths.length === 0) return null;

  const existingPreload = process.env.LD_PRELOAD ?? "";
  const parts = [existingPreload, ...overlayPaths]
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.join(":");
};

/**
 * Finds the Steam Linux Runtime _v2-entry-point in the client's
 * libraries (sniper first, soldier fallback). Wrapping the direct
 * Proton launch with it reproduces the container Steam itself uses.
 */
export const findSteamRuntimeEntryPoint = async (): Promise<string | null> => {
  try {
    const libraries = await getSteamLibraryFolders();
    for (const candidate of buildSteamRuntimeCandidatePaths(libraries)) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // Unreadable library — try the next candidate.
      }
    }
  } catch {
    // Library parsing is best-effort.
  }
  return null;
};

/**
 * Scans the game folder for the Online-Fix patch DLLs — used by the
 * diagnostics IPC to warn when an antivirus quarantined the fix (the
 * classic "failed to load steam overlay dll, error 126" cause).
 */
export const findOnlineFixMarkers = (gameDir: string): string[] =>
  findOnlineFixMarkerDlls(collectOnlineFixDllNames(gameDir));

// ---------------------------------------------------------------------------
// Patch payload preparation (mirroring + onlinefix.ini hygiene)
// ---------------------------------------------------------------------------

export interface OnlineFixGameFolderPreparation {
  mirrored: string[];
  fakeAppId: string | null;
}

const listDirectoryEntries = (directory: string) => {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
};

const copyIfMissing = (sourcePath: string, targetPath: string) => {
  try {
    if (fs.existsSync(targetPath)) return false;
    const stats = fs.statSync(sourcePath);
    if (!stats.isFile() || stats.size > ONLINE_FIX_MIRROR_MAX_FILE_BYTES) {
      return false;
    }
    fs.copyFileSync(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
};

const copyDirectoryIfMissing = (sourcePath: string, targetPath: string) => {
  try {
    if (fs.existsSync(targetPath)) return false;
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: false });
    return true;
  } catch {
    return false;
  }
};

/**
 * Mirrors the Online-Fix payload between the game root and the folder
 * holding the executable (slsdeck-proven fix for Unreal-style layouts:
 * packages ship the fix at the root while the loader resolves its
 * dependencies next to the running exe), then sanitizes onlinefix.ini
 * (ExtraProtection=false, OFLL #53) and captures FakeAppId for the
 * overlay session. Never throws — a failed preparation still launches.
 */
export const prepareOnlineFixGameFolder = async (
  executableDirectory: string
): Promise<OnlineFixGameFolderPreparation> => {
  const preparation: OnlineFixGameFolderPreparation = {
    mirrored: [],
    fakeAppId: null,
  };

  try {
    const gameRoot = path.dirname(executableDirectory);

    if (gameRoot !== executableDirectory) {
      const exeEntries = listDirectoryEntries(executableDirectory);
      const rootEntries = listDirectoryEntries(gameRoot);
      const exeNames = new Set(exeEntries.map((entry) => entry.name));
      const rootNames = new Set(rootEntries.map((entry) => entry.name));

      const lowerCasePayloadFiles = new Set(
        ONLINE_FIX_PAYLOAD_FILES.map((file) => file.toLowerCase())
      );

      for (const entry of rootEntries) {
        const isPayloadFile =
          entry.isFile() && lowerCasePayloadFiles.has(entry.name.toLowerCase());
        const isPayloadDirectory =
          entry.isDirectory() &&
          (ONLINE_FIX_PAYLOAD_DIRECTORIES as readonly string[]).includes(
            entry.name.toLowerCase()
          );

        if (!isPayloadFile && !isPayloadDirectory) continue;
        if (exeNames.has(entry.name)) continue;

        const sourcePath = path.join(gameRoot, entry.name);
        const targetPath = path.join(executableDirectory, entry.name);
        const copied = isPayloadDirectory
          ? copyDirectoryIfMissing(sourcePath, targetPath)
          : copyIfMissing(sourcePath, targetPath);
        if (copied) preparation.mirrored.push(entry.name);
      }

      // Mirror the other way too: sibling executables at the root need
      // the payload next to themselves when the package shipped it in
      // the exe's subfolder.
      for (const entry of exeEntries) {
        const isPayloadFile =
          entry.isFile() && lowerCasePayloadFiles.has(entry.name.toLowerCase());
        if (!isPayloadFile) continue;
        if (rootNames.has(entry.name)) continue;

        const copied = copyIfMissing(
          path.join(executableDirectory, entry.name),
          path.join(gameRoot, entry.name)
        );
        if (copied) preparation.mirrored.push(entry.name);
      }
    }

    const iniPath = path.join(executableDirectory, "onlinefix.ini");
    try {
      if (fs.existsSync(iniPath)) {
        const content = await fs.promises.readFile(iniPath, "utf8");
        const sanitized = sanitizeOnlineFixIni(content);
        preparation.fakeAppId = sanitized.fakeAppId;
        if (sanitized.changed) {
          await fs.promises.writeFile(iniPath, sanitized.content, "utf8");
          logger.info(
            "[Online Fix] onlinefix.ini sanitized (ExtraProtection=false)"
          );
        }
      }
    } catch {
      // Ini hygiene is best-effort.
    }

    if (preparation.mirrored.length > 0) {
      logger.info("[Online Fix] payload mirrored next to the executable", {
        mirrored: preparation.mirrored,
      });
    }
  } catch (error) {
    logger.warn("[Online Fix] payload preparation failed — launching anyway", {
      error,
    });
  }

  return preparation;
};

// ---------------------------------------------------------------------------
// Prefix runtime seeding (VC++ 2015-2022 via umu-run winetricks)
// ---------------------------------------------------------------------------

const ONLINE_FIX_RUNTIME_STAMP = "hydra-onlinefix-runtime.json";
const ONLINE_FIX_RUNTIME_MAX_ATTEMPTS = 2;

type OnlineFixRuntimeStamp = {
  status: "ok" | "failed";
  attempts: number;
  updatedAt: string;
};

const readRuntimeStamp = (
  winePrefixPath: string
): OnlineFixRuntimeStamp | null => {
  try {
    const raw = fs.readFileSync(
      path.join(winePrefixPath, ONLINE_FIX_RUNTIME_STAMP),
      "utf8"
    );
    return JSON.parse(raw) as OnlineFixRuntimeStamp;
  } catch {
    return null;
  }
};

const writeRuntimeStamp = (
  winePrefixPath: string,
  stamp: Omit<OnlineFixRuntimeStamp, "updatedAt">
) => {
  try {
    fs.writeFileSync(
      path.join(winePrefixPath, ONLINE_FIX_RUNTIME_STAMP),
      JSON.stringify({ ...stamp, updatedAt: new Date().toISOString() })
    );
  } catch {
    // Stamp persistence is best-effort.
  }
};

/**
 * Seeds the VC++ 2015-2022 runtime into the Wine prefix ONCE via
 * `umu-run winetricks vcrun2022` — umu runs it inside the Steam Runtime
 * container and skips already-installed verbs. The classic "error 126"
 * on Linux is a missing VC dependency of the fix payload; Wine prefixes
 * only ship built-in runtimes, and online-fix packages expect the
 * Microsoft ones (community launchers treat vcrun2022 as the default
 * cure). Never blocks the launch on failure and gives up after two
 * attempts so offline machines keep launching instantly.
 */
export const ensureOnlineFixRuntimeReady = async (options: {
  winePrefixPath: string;
  protonPath?: string | null;
  gameId?: string | null;
}): Promise<boolean> => {
  const { winePrefixPath } = options;

  const stamp = readRuntimeStamp(winePrefixPath);
  if (stamp?.status === "ok") return true;
  if (
    stamp &&
    stamp.status === "failed" &&
    stamp.attempts >= ONLINE_FIX_RUNTIME_MAX_ATTEMPTS
  ) {
    return false;
  }

  const { Umu } = await import("./umu");
  const seeded = await Umu.runWinetricksVerb({
    winePrefixPath,
    protonPath: options.protonPath,
    gameId: options.gameId,
    verb: "vcrun2022",
  }).catch(() => false);

  const attempts = (stamp?.attempts ?? 0) + 1;
  writeRuntimeStamp(winePrefixPath, {
    status: seeded ? "ok" : "failed",
    attempts,
  });

  if (seeded) {
    logger.info("[Online Fix] VC++ runtime seeded into the Wine prefix");
  } else {
    logger.warn(
      `[Online Fix] winetricks vcrun2022 failed (attempt ${attempts}) — continuing without it`
    );
  }

  return seeded;
};

// ---------------------------------------------------------------------------
// Launch diagnostics (umu.log err:module tail)
// ---------------------------------------------------------------------------

/**
 * Extracts the last Wine module error from umu.log (games launched with
 * WINEDEBUG=+err log `err:module:import_dll ...` naming the missing
 * dependency) so the Online tab can show WHY a launch died with error
 * 126 instead of a bare code.
 */
export const readLastWineModuleError = (): string | null => {
  try {
    const umuLogPath = path.join(logsPath, "umu.log");
    const stats = fs.statSync(umuLogPath);
    if (!stats.isFile()) return null;

    const readBytes = Math.min(stats.size, 64 * 1024);
    const handle = fs.openSync(umuLogPath, "r");
    try {
      const buffer = Buffer.alloc(readBytes);
      fs.readSync(handle, buffer, 0, readBytes, stats.size - readBytes);
      const tail = buffer.toString("utf8");
      const matches = tail.match(/err:module[^\n]*/g);
      return matches?.length ? matches[matches.length - 1].trim() : null;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Steam client management (Windows + Linux)
// ---------------------------------------------------------------------------

const isTasklistProcessRunning = async (image: string): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync("tasklist", [
      "/FI",
      `IMAGENAME eq ${image}`,
      "/NH",
    ]);
    return stdout.toLowerCase().includes(image.toLowerCase());
  } catch {
    return false;
  }
};

const getWindowsSteamExecutable = async (): Promise<string | null> => {
  const registryCandidates: string[] = [];

  try {
    const { stdout } = await execFileAsync("reg", [
      "query",
      "HKCU\\Software\\Valve\\Steam",
      "/v",
      "SteamPath",
    ]);
    const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match?.[1]) registryCandidates.push(match[1].trim());
  } catch {
    // Registry unavailable — fall back to the standard install paths.
  }

  const programFiles = process.env["ProgramFiles(x86)"];
  if (programFiles)
    registryCandidates.push(path.win32.join(programFiles, "Steam"));
  if (process.env.ProgramFiles)
    registryCandidates.push(path.win32.join(process.env.ProgramFiles, "Steam"));

  for (const candidate of registryCandidates) {
    if (!candidate) continue;
    const steamExe = candidate.endsWith(".exe")
      ? candidate
      : path.win32.join(candidate, "steam.exe");
    try {
      await fs.promises.access(steamExe);
      return steamExe;
    } catch {
      // Candidate missing — try the next one.
    }
  }

  return null;
};

export const isSteamClientRunning = async (): Promise<boolean> => {
  try {
    if (process.platform === "win32") {
      return await isTasklistProcessRunning("steam.exe");
    }

    const { stdout } = await execFileAsync("pidof", ["steam"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
};

const spawnDetached = (file: string, args: string[]): boolean => {
  try {
    if (file.includes("/")) {
      fs.accessSync(file, fs.constants.X_OK);
    }
    const child = spawn(file, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch (error) {
    logger.warn("[Online Fix] Failed to spawn the Steam client candidate", {
      file,
      error,
    });
    return false;
  }
};

const spawnSteamClient = async (): Promise<boolean> => {
  try {
    if (process.platform === "win32") {
      const steamExe = await getWindowsSteamExecutable();
      if (!steamExe) {
        logger.warn("[Online Fix] Steam executable not found on Windows");
        return false;
      }

      return spawnDetached(steamExe, ["-silent"]);
    }

    // Launch the client through the SAME channel the user's system
    // actually uses for Steam — spawning the wrong kind fails silently
    // or opens a second, broken install (OFLL #65).
    const kind = detectSteamInstallKind();

    const candidates: string[][] =
      kind === "flatpak"
        ? [["flatpak", "run", "com.valvesoftware.Steam", "-silent"]]
        : kind === "snap"
          ? [
              ["/snap/bin/steam", "-silent"],
              ["snap", "run", "steam", "-silent"],
            ]
          : kind === "unknown"
            ? [
                ["steam", "-silent"],
                ["flatpak", "run", "com.valvesoftware.Steam", "-silent"],
                ["/snap/bin/steam", "-silent"],
              ]
            : [["steam", "-silent"]];

    for (const [file, ...args] of candidates) {
      if (spawnDetached(file, args)) {
        // Give the client a short window to appear before trying the
        // next candidate so the wrong-channel spawn can be detected.
        const appeared = await waitForSteamClient(8_000);
        if (appeared) return true;
      }
    }

    return false;
  } catch (error) {
    logger.warn("[Online Fix] Failed to spawn the Steam client", error);
    return false;
  }
};

const NATIVE_STEAM_BINARY_PATHS = [
  "/usr/bin/steam",
  "/usr/local/bin/steam",
  "/bin/steam",
  "/usr/games/steam",
];

const hasNativeSteamBinary = (): boolean => {
  for (const binaryPath of NATIVE_STEAM_BINARY_PATHS) {
    try {
      if (fs.existsSync(binaryPath)) return true;
    } catch {
      // Unreadable location — try the next one.
    }
  }

  try {
    const which = spawnSync("which", ["steam"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return which.status === 0;
  } catch {
    return false;
  }
};

const isFlatpakSteamRegistered = (): boolean => {
  try {
    const info = spawnSync("flatpak", ["info", "com.valvesoftware.Steam"], {
      stdio: ["ignore", "ignore", "ignore"],
      encoding: "utf8",
    });
    return info.status === 0;
  } catch {
    return false;
  }
};

const isSnapSteamRegistered = (): boolean => {
  try {
    const list = spawnSync("snap", ["list", "steam"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return list.status === 0;
  } catch {
    return false;
  }
};

const directoryPresent = (segments: readonly string[]): boolean => {
  try {
    return fs.existsSync(path.join(process.env.HOME ?? "", ...segments));
  } catch {
    return false;
  }
};

export type SteamInstallKind = "native" | "flatpak" | "snap" | "unknown";

/**
 * Detects how the Steam client is installed. Package-level signals
 * (native binary, `flatpak info`, `snap list`) decide first; data
 * directories are the LAST resort because leftover directories are
 * common — a machine that once tried the Flatpak Steam keeps
 * ~/.var/app/com.valvesoftware.Steam even after switching to the
 * distribution's native package (multilib and friends), which made the
 * old directory-first check report "Flatpak" for native users.
 */
export const detectSteamInstallKind = (): SteamInstallKind =>
  resolveSteamInstallKind({
    nativeBinaryAvailable: hasNativeSteamBinary(),
    nativeSteamRootPresent: directoryPresent([".steam", "steam"]),
    flatpakRegistered: isFlatpakSteamRegistered(),
    flatpakDirPresent: directoryPresent([
      ".var",
      "app",
      "com.valvesoftware.Steam",
    ]),
    snapRegistered: isSnapSteamRegistered(),
    snapDirPresent: directoryPresent(["snap", "steam"]),
  });

const waitForSteamClient = async (timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isSteamClientRunning()) return true;
    await new Promise((resolve) => setTimeout(resolve, STEAM_POLL_INTERVAL_MS));
  }
  return isSteamClientRunning();
};

/**
 * Guarantees the Steam client is up before an online session. Returns
 * true when the client is running; false means the launch should still
 * proceed (the game may work anyway), with the failure logged.
 */
export const ensureSteamClientRunning = async (): Promise<boolean> => {
  if (await isSteamClientRunning()) return true;

  logger.info("[Online Fix] Steam client not running — starting it");
  const spawned = await spawnSteamClient();
  if (!spawned) return false;

  const ready = await waitForSteamClient(STEAM_WAIT_TIMEOUT_MS);
  if (ready) {
    logger.info("[Online Fix] Steam client is up");
  } else {
    logger.warn(
      "[Online Fix] Steam client did not report running in time — launching anyway"
    );
  }
  return ready;
};
