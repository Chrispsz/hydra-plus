import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

import { logger } from "./logger";
import {
  buildOnlineFixDllOverrides,
  buildWindowsOnlineFixPath,
  findOnlineFixMarkerDlls,
} from "./online-fix-core";

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
 *    DLL gets a "native,builtin" override, so the fix's payload DLLs
 *    (OnlineFix64, SteamOverlay64, dnet, steam_api64, proxy DLLs like
 *    winmm/dinput8) shadow Wine's built-ins exactly as on Windows,
 *    alongside the community D3D override recipe;
 * 3. on Wine/Proton sessions the Steam overlay is injected the way OFLL
 *    does it: LD_PRELOAD the native gameoverlayrenderer.so (32+64) from
 *    the Steam client install plus SteamOverlayGameId=480, so the fix
 *    finds an overlay to hook instead of failing with "error 126";
 * 4. keep Wine quiet (WINEDEBUG=-all) like the community launchers do.
 * 5. on Windows the game folder is prepended to PATH and the game is
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
 * Wine env for online sessions (native D3D path + game DLLs + Steam
 * overlay injection, quiet logs). Linux only.
 */
export const getOnlineFixLaunchEnv = (
  gameDir: string
): Record<string, string> => {
  const env: Record<string, string> = {
    WINEDLLOVERRIDES: buildOnlineFixDllOverrides(
      collectOnlineFixDllNames(gameDir)
    ),
    WINEDEBUG: "-all",
  };

  const overlayPreload = buildSteamOverlayPreload();
  if (overlayPreload) {
    env.LD_PRELOAD = overlayPreload;
    env.SteamOverlayGameId = STEAM_OVERLAY_GAME_ID;
  }

  return env;
};

/**
 * Windows env for online sessions: the game folder must be on PATH so
 * the patch's payload DLLs resolve by name regardless of the working
 * directory the game is spawned with.
 */
export const getWindowsOnlineFixLaunchEnv = (
  gameDir: string
): Record<string, string> => ({
  PATH: buildWindowsOnlineFixPath(gameDir, process.env.PATH ?? ""),
});

// ---------------------------------------------------------------------------
// Steam overlay injection (Linux, OFLL recipe)
// ---------------------------------------------------------------------------

export const STEAM_OVERLAY_GAME_ID = "480";

const STEAM_BASE_DIRECTORIES = [
  path.join(process.env.HOME ?? "", ".steam", "steam"),
  path.join(process.env.HOME ?? "", ".local", "share", "Steam"),
];

const OVERLAY_LIB_RELATIVE_PATHS = [
  path.join("ubuntu12_32", "gameoverlayrenderer.so"),
  path.join("ubuntu12_64", "gameoverlayrenderer.so"),
];

/**
 * Builds the LD_PRELOAD value pointing at the native Steam overlay
 * renderer (32+64 bit) when the Steam client install provides one.
 * Returns null (and leaves the env untouched) when no overlay library
 * exists on this machine, so non-Steam setups launch exactly as before.
 */
export const buildSteamOverlayPreload = (): string | null => {
  const overlayPaths: string[] = [];

  for (const steamBase of STEAM_BASE_DIRECTORIES) {
    if (!steamBase) continue;

    for (const relativePath of OVERLAY_LIB_RELATIVE_PATHS) {
      const overlayPath = path.join(steamBase, relativePath);
      try {
        if (fs.existsSync(overlayPath)) overlayPaths.push(overlayPath);
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
 * Scans the game folder for the Online-Fix patch DLLs — used by the
 * diagnostics IPC to warn when an antivirus quarantined the fix (the
 * classic "failed to load steam overlay dll, error 126" cause).
 */
export const findOnlineFixMarkers = (gameDir: string): string[] =>
  findOnlineFixMarkerDlls(collectOnlineFixDllNames(gameDir));

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

const spawnSteamClient = async (): Promise<boolean> => {
  try {
    if (process.platform === "win32") {
      const steamExe = await getWindowsSteamExecutable();
      if (!steamExe) {
        logger.warn("[Online Fix] Steam executable not found on Windows");
        return false;
      }

      const child = spawn(steamExe, ["-silent"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    }

    const child = spawn("steam", [], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch (error) {
    logger.warn("[Online Fix] Failed to spawn the Steam client", error);
    return false;
  }
};

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
