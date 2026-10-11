import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Online (Online-Fix) launch session.
 *
 * Online-Fix patches use the user's real Steam client for multiplayer —
 * the "Spacewar" (appid 480) relay shows up in the Steam UI while the
 * game's own patched steam_api drives the lobbies. Dedicated Linux tools
 * (SOFL, OFLL) all follow the same recipe, which this service mirrors:
 *
 * 1. make sure the Steam client is running and signed in before launch;
 * 2. keep the Direct3D path native under Wine (no DXVK translation) so
 *    the Steam overlay and networking hooks load as on Windows, via
 *    WINEDLLOVERRIDES disabling the d3d and dxgi translations.
 *
 * The game itself is still launched through the universal umu/Proton
 * pipeline — this only prepares the environment around it.
 */

const ONLINE_FIX_DLLOVERRIDES =
  "d3d11=n;d3d10=n;d3d10core=n;dxgi=n;openvr_api_dxvk=n;d3d12=n;d3d12core=n;d3d9=n;d3d8=n";

const STEAM_WAIT_TIMEOUT_MS = 45_000;
const STEAM_POLL_INTERVAL_MS = 1_000;

export const isSteamClientRunning = async (): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync("pidof", ["steam"]);
    return stdout.trim().length > 0;
  } catch {
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
  try {
    const child = spawn("steam", [], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (error) {
    logger.warn("[Online Fix] Failed to spawn the Steam client", error);
    return false;
  }

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

/** Wine env for online sessions (native D3D path, no DXVK). */
export const getOnlineFixLaunchEnv = (): Record<string, string> => ({
  WINEDLLOVERRIDES: ONLINE_FIX_DLLOVERRIDES,
});
