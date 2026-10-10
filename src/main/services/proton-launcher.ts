import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { is } from "@electron-toolkit/utils";

import { logsPath } from "@main/constants";
import { getSteamLocation } from "@main/services/steam";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";

import { resolveLaunchCommand } from "@main/helpers/resolve-launch-command";

/**
 * Direct Proton runner.
 *
 * umu-run is a convenience wrapper, but it drags a Python runtime, its own
 * runtime setup and its own prefix conventions into every launch — and it
 * cannot reach Proton features Steam itself uses. Running `<proton>/proton`
 * directly with the Steam compat environment is what Steam / Heroic / Lutris
 * effectively do under the hood, and it is the most faithful way to run a
 * game the way Steam would:
 *
 *   STEAM_COMPAT_CLIENT_INSTALL_PATH = Steam root (pressure-vessel host)
 *   STEAM_COMPAT_DATA_PATH           = prefix "compatdata" dir
 *   STEAM_COMPAT_PREFIX_PATH         = the actual wine prefix
 *   proton waitforexitandrun <exe> [args]
 *
 * umu stays available as an automatic fallback.
 */

const QUICK_EXIT_THRESHOLD_MS = 3000;

const isValidProtonDirectory = (dir: string): boolean => {
  try {
    return (
      fs.statSync(path.join(dir, "proton")).isFile() &&
      fs.statSync(path.join(dir, "toolmanifest.vdf")).isFile()
    );
  } catch {
    return false;
  }
};

const getProtonLogPath = () => path.join(logsPath, "proton.log");

/**
 * Proton derives the wine prefix from STEAM_COMPAT_DATA_PATH/pfx unless
 * STEAM_COMPAT_PREFIX_PATH overrides it. For prefixes whose basename is
 * already "pfx" (Steam compatdata layouts) we point DATA_PATH at the parent
 * so the pair stays consistent even for old Proton builds.
 */
const resolveCompatDataPath = (winePrefixPath: string): string => {
  if (path.basename(winePrefixPath).toLowerCase() === "pfx") {
    return path.dirname(winePrefixPath);
  }
  return winePrefixPath;
};

export const isValidProtonForDirectLaunch = (protonPath?: string | null) =>
  Boolean(protonPath) && isValidProtonDirectory(protonPath as string);

const ensureProtonExecutable = (protonPath: string) => {
  const protonScript = path.join(protonPath, "proton");
  try {
    fs.accessSync(protonScript, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(protonScript, 0o755);
    } catch (error) {
      logger.warn("Failed to make proton script executable", error);
    }
  }
  return protonScript;
};

const appendProtonLog = (message: string) => {
  const logPath = getProtonLogPath();
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, message);
  } catch {
    // Logging must never break launching.
  }
};

const buildProtonEnv = async (options: {
  winePrefixPath: string;
  gameId?: string | null;
  useMangohud?: boolean;
  extraEnv?: Record<string, string>;
}): Promise<Record<string, string>> => {
  const steamRoot = await getSteamLocation();
  if (!steamRoot) {
    throw new Error("proton_steam_root_unresolved");
  }

  const compatDataPath = resolveCompatDataPath(options.winePrefixPath);

  return {
    PROTON_LOG: "1",
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
    STEAM_COMPAT_DATA_PATH: compatDataPath,
    STEAM_COMPAT_PREFIX_PATH: options.winePrefixPath,
    STEAM_COMPAT_INSTALL_PATH: process.cwd(),
    SteamAppId: /^\d+$/.test(options.gameId ?? "")
      ? (options.gameId as string)
      : "0",
    SteamGameId: /^\d+$/.test(options.gameId ?? "")
      ? (options.gameId as string)
      : "0",
    ...(options.useMangohud ? { MANGOHUD: "1" } : {}),
    ...(options.extraEnv ?? {}),
  };
};

const spawnProtonVerb = async (options: {
  protonPath: string;
  verb: string;
  verbArgs: string[];
  winePrefixPath: string;
  gameId?: string | null;
  detached: boolean;
  useMangohud?: boolean;
}): Promise<void> => {
  const protonScript = ensureProtonExecutable(options.protonPath);
  const env = await buildProtonEnv({
    winePrefixPath: options.winePrefixPath,
    gameId: options.gameId,
    useMangohud: options.useMangohud,
  });

  const logPath = getProtonLogPath();
  const header =
    `\n[${new Date().toISOString()}] proton ${options.verb}\n` +
    `Prefix: ${options.winePrefixPath}\n` +
    `Proton: ${options.protonPath}\n`;
  appendProtonLog(header);

  logger.info("Running Proton directly", {
    verb: options.verb,
    protonPath: options.protonPath,
    winePrefixPath: options.winePrefixPath,
    env,
  });

  return new Promise<void>((resolve, reject) => {
    const shouldPipeToTerminal = is.dev;
    const logFileDescriptor = shouldPipeToTerminal
      ? null
      : fs.openSync(logPath, "a");
    let settled = false;

    const finalize = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (logFileDescriptor !== null) fs.closeSync(logFileDescriptor);
      callback();
    };

    const child = spawn(protonScript, [options.verb, ...options.verbArgs], {
      detached: options.detached,
      stdio: shouldPipeToTerminal
        ? "inherit"
        : ["ignore", logFileDescriptor, logFileDescriptor],
      shell: false,
      cwd: SystemPath.getPath("home"),
      env: {
        ...process.env,
        ...env,
      },
    });

    child.once("error", (error) => {
      finalize(() => reject(error));
    });

    child.once("close", (code, signal) => {
      finalize(() => {
        if (code === 0) {
          resolve();
          return;
        }
        const message = `proton ${options.verb} exited with code=${code ?? "null"} signal=${signal ?? "null"}`;
        appendProtonLog(`[${new Date().toISOString()}] ${message}\n`);
        reject(new Error(message));
      });
    });
  });
};

export const ProtonRunner = {
  /** Best-effort prefix bootstrap; the game launch itself also creates it. */
  async preparePrefix(options: {
    winePrefixPath: string;
    protonPath?: string | null;
    gameId?: string | null;
  }): Promise<void> {
    if (!isValidProtonForDirectLaunch(options.protonPath)) {
      throw new Error("proton_path_invalid");
    }
    fs.mkdirSync(path.dirname(options.winePrefixPath), { recursive: true });
    await spawnProtonVerb({
      protonPath: options.protonPath as string,
      verb: "waitforexitandrun",
      verbArgs: ["wineboot"],
      winePrefixPath: options.winePrefixPath,
      gameId: options.gameId,
      detached: false,
    });
  },

  async launchExecutable(
    executablePath: string,
    launchParameters: string[] = [],
    options?: {
      winePrefixPath?: string | null;
      protonPath?: string | null;
      gameId?: string | null;
      launchOptions?: string | null;
      useMangohud?: boolean;
      useGamemode?: boolean;
    }
  ): Promise<void> {
    if (!options?.winePrefixPath) {
      throw new Error("proton_prefix_unresolved");
    }
    if (!isValidProtonForDirectLaunch(options.protonPath)) {
      throw new Error("proton_path_invalid");
    }

    const workingDirectory = path.dirname(executablePath);
    const resolvedLaunchCommand = resolveLaunchCommand({
      baseCommand: path.join(options.protonPath as string, "proton"),
      baseArgs: ["waitforexitandrun", executablePath, ...launchParameters],
      launchOptions: options.launchOptions,
      wrapperCommands: [...(options.useGamemode ? ["gamemoderun"] : [])],
    });

    const env = await buildProtonEnv({
      winePrefixPath: options.winePrefixPath,
      gameId: options.gameId,
      useMangohud: options.useMangohud,
      extraEnv: resolvedLaunchCommand.env,
    });

    const logPath = getProtonLogPath();
    const envCommandPart = Object.entries(env)
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(" ");
    appendProtonLog(
      `\n[${new Date().toISOString()}] Launching with direct Proton\n` +
        `Command: ${envCommandPart} "${resolvedLaunchCommand.command}" ${resolvedLaunchCommand.args
          .map((arg) => `"${arg}"`)
          .join(" ")}\n`
    );

    logger.info("Launching game with direct Proton", {
      command: resolvedLaunchCommand.command,
      args: resolvedLaunchCommand.args,
      cwd: workingDirectory,
      winePrefixPath: options.winePrefixPath,
    });

    return new Promise<void>((resolve, reject) => {
      const shouldPipeToTerminal = is.dev;
      const logFileDescriptor = shouldPipeToTerminal
        ? null
        : fs.openSync(logPath, "a");
      let settled = false;

      const finalize = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (logFileDescriptor !== null) fs.closeSync(logFileDescriptor);
        callback();
      };

      const child = spawn(
        resolvedLaunchCommand.command,
        resolvedLaunchCommand.args,
        {
          detached: true,
          stdio: shouldPipeToTerminal
            ? "inherit"
            : ["ignore", logFileDescriptor, logFileDescriptor],
          shell: false,
          cwd: workingDirectory,
          env: {
            ...process.env,
            ...env,
          },
        }
      );

      let quickExitTimer: NodeJS.Timeout | null = null;

      child.once("spawn", () => {
        quickExitTimer = setTimeout(() => {
          finalize(() => {
            child.unref();
            resolve();
          });
        }, QUICK_EXIT_THRESHOLD_MS);
      });

      child.once("exit", (code, signal) => {
        if (quickExitTimer) {
          clearTimeout(quickExitTimer);
          quickExitTimer = null;
        }
        finalize(() => {
          const message = `proton exited early with code=${code ?? "null"} signal=${signal ?? "null"}`;
          appendProtonLog(`[${new Date().toISOString()}] ${message}\n`);
          reject(new Error(message));
        });
      });

      child.once("error", (error) => {
        if (quickExitTimer) {
          clearTimeout(quickExitTimer);
          quickExitTimer = null;
        }
        finalize(() => {
          appendProtonLog(
            `[${new Date().toISOString()}] Failed to spawn proton: ${String(error)}\n`
          );
          reject(error);
        });
      });
    });
  },

  isValidProtonDirectory,
};
