import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

import { logger } from "./logger";
import { buildOnlineFixDllOverrides } from "./online-fix-core";

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
 *    folder is scanned and every shipped DLL gets a "native,builtin"
 *    override, so the fix's proxy DLLs (winmm, dinput8, version, ...)
 *    shadow Wine's built-ins exactly as on Windows, alongside the
 *    community D3D override recipe (native Direct3D path, no wined3d);
 * 3. keep Wine quiet (WINEDEBUG=-all) like the community launchers do.
 *
 * The game itself is still launched through the universal umu/Proton
 * pipeline on Linux — this only prepares the environment around it.
 */

const STEAM_WAIT_TIMEOUT_MS = 45_000;
const STEAM_POLL_INTERVAL_MS = 1_000;

/** Wine env for online sessions (native D3D path + game DLLs, quiet logs). */
export const getOnlineFixLaunchEnv = (
  gameDir: string
): Record<string, string> => {
  let dllNames: string[] = [];

  try {
    dllNames = fs
      .readdirSync(gameDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => path.extname(name).toLowerCase() === ".dll");
  } catch (error) {
    logger.warn("[Online Fix] Failed to scan game folder for DLLs", error);
  }

  return {
    WINEDLLOVERRIDES: buildOnlineFixDllOverrides(dllNames),
    WINEDEBUG: "-all",
  };
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
