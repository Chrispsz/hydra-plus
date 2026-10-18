import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { SystemPath } from "./system-path";
import { logsPath } from "@main/constants";
import { logger } from "./logger";
import type { ProtonVersion } from "@types";
import {
  mergeLegacyLaunchToggles,
  resolveLaunchFlags,
} from "@shared/launch-flags";
import { resolveLaunchCommand } from "@main/helpers/resolve-launch-command";
import { isGamemodeAvailable } from "@main/helpers/is-gamemode-available";
import { isGamescopeAvailable } from "@main/helpers/is-gamescope-available";
import { isMangohudAvailable } from "@main/helpers/is-mangohud-available";
import { evaluateUmuPrefixPreparation } from "./umu-prefix-preparation";
import { Wine } from "./wine";
import { getSteamLibraryFolders } from "./steam";

const isValidProtonDirectory = (directoryPath: string) => {
  const protonFilePath = path.join(directoryPath, "proton");
  const toolManifestPath = path.join(directoryPath, "toolmanifest.vdf");

  return fs.existsSync(protonFilePath) && fs.existsSync(toolManifestPath);
};

const getVersionName = (directoryPath: string) => {
  return path.basename(directoryPath);
};

const getUmuLogPath = () => path.join(logsPath, "umu.log");

const UMU_LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Cheap rotation: an oversized log is renamed to `.old` (replacing any
 * previous one) so a long-lived installation cannot grow umu.log
 * without bounds. Best-effort — logging must never break launching.
 */
const rotateUmuLogIfNeeded = (umuLogPath: string) => {
  try {
    if (fs.statSync(umuLogPath).size <= UMU_LOG_MAX_BYTES) return;

    try {
      fs.renameSync(umuLogPath, `${umuLogPath}.old`);
    } catch {
      fs.rmSync(umuLogPath, { force: true });
    }
  } catch {
    // No log yet, or rotation failed — keep going.
  }
};

const getUmuBinaryPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "umu-run")
    : path.join(__dirname, "..", "..", "binaries", "umu", "umu-run");

const parsePythonVersion = (versionText: string): [number, number] | null => {
  const match = versionText.trim().match(/^(\d+)\.(\d+)$/);
  if (!match) return null;

  return [Number(match[1]), Number(match[2])];
};

const hasSupportedPythonVersion = (version: [number, number]) => {
  const [major, minor] = version;
  return major > 3 || (major === 3 && minor >= 10);
};

const PYTHON_PROBE_TIMEOUT_MS = 5_000;

/**
 * Module-level cache for the python3 probe: environment detection does
 * not change between launches, and the blocking spawnSync must not
 * freeze the main process on every compatible launch.
 */
let compatiblePythonPath: string | null | undefined;

const getCompatiblePythonPath = (): string | null => {
  if (compatiblePythonPath !== undefined) return compatiblePythonPath;

  const candidates = [
    process.env.HYDRA_UMU_PYTHON,
    "/usr/bin/python3",
    "python3",
  ]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  for (const candidate of candidates) {
    try {
      const result = spawnSync(
        candidate,
        [
          "-c",
          "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')",
        ],
        {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
          shell: false,
          timeout: PYTHON_PROBE_TIMEOUT_MS,
        }
      );

      // A timed out or failed probe counts as "not available", never as
      // a crash — the umu-run binary fallback below handles it.
      if (result.status !== 0) continue;

      const version = parsePythonVersion(result.stdout);
      if (!version || !hasSupportedPythonVersion(version)) continue;

      compatiblePythonPath = candidate;
      return candidate;
    } catch {
      continue;
    }
  }

  compatiblePythonPath = null;
  return null;
};

const ensureExecutablePermission = (binaryPath: string) => {
  if (process.platform === "win32") return;

  try {
    const currentMode = fs.statSync(binaryPath).mode;
    const hasAnyExecuteBit = (currentMode & 0o111) !== 0;

    if (!hasAnyExecuteBit) {
      fs.chmodSync(binaryPath, 0o755);
    }
  } catch (error) {
    logger.warn("Failed to ensure umu-run executable permission", {
      binaryPath,
      error,
    });
  }
};

const STEAM_ROOT_SEGMENTS = [
  [".steam", "steam"],
  [".local", "share", "Steam"],
  [".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"],
  [".var", "app", "com.valvesoftware.Steam", "data", "Steam"],
  ["snap", "steam", "common", ".local", "share", "Steam"],
];

/** System-level compatibility tool directories (Arch/CachyOS/Debian packages). */
const SYSTEM_COMPATIBILITY_TOOL_PATHS = [
  path.join("/usr", "lib", "steam", "compatibilitytools.d"),
  path.join("/usr", "share", "steam", "compatibilitytools.d"),
  path.join("/usr", "local", "share", "steam", "compatibilitytools.d"),
];

/** Where Heroic installs user-provided Proton builds (native + Flatpak). */
const HEROIC_PROTON_TOOL_PATHS = (homePath: string) => [
  path.join(homePath, ".config", "heroic", "tools", "proton"),
  path.join(
    homePath,
    ".var",
    "app",
    "com.heroicgameslauncher.hgl",
    "config",
    "heroic",
    "tools",
    "proton"
  ),
];

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Steam's official mechanism for extra compatibility tool locations
 * (colon-separated; used by NixOS and custom distro packaging).
 */
const readExtraCompatToolPaths = (): string[] => {
  const raw = process.env.STEAM_EXTRA_COMPAT_TOOLS_PATHS;
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export class Umu {
  public static isValidProtonPath(protonPath: string) {
    return isValidProtonDirectory(protonPath);
  }

  public static async getInstalledProtonVersions(): Promise<ProtonVersion[]> {
    const homePath = SystemPath.getPath("home");
    const steamRoots = STEAM_ROOT_SEGMENTS.map((segments) =>
      path.join(homePath, ...segments)
    );
    const libraryFolders = await getSteamLibraryFolders().catch(() => []);

    const steamCommonPaths = [
      ...new Set(
        [...steamRoots, ...libraryFolders].map((root) =>
          path.join(root, "steamapps", "common")
        )
      ),
    ];
    // compatibilitytools.d candidates: per-user Steam roots, every Steam
    // library (some distros symlink the tools dir per library), system
    // package paths (proton-cachyos etc.) and Heroic's tool directory.
    const compatibilityToolPaths = [
      ...steamRoots.map((root) => path.join(root, "compatibilitytools.d")),
      ...libraryFolders.flatMap((library) => [
        path.join(library, "compatibilitytools.d"),
        path.join(library, "root", "compatibilitytools.d"),
      ]),
      ...SYSTEM_COMPATIBILITY_TOOL_PATHS,
      ...HEROIC_PROTON_TOOL_PATHS(homePath),
      ...readExtraCompatToolPaths(),
    ];

    const versions: ProtonVersion[] = [];

    for (const steamCommonPath of steamCommonPaths) {
      if (!fs.existsSync(steamCommonPath)) {
        continue;
      }

      const steamCommonEntries = await fs.promises
        .readdir(steamCommonPath, { withFileTypes: true })
        .catch(() => [] as fs.Dirent[]);

      for (const entry of steamCommonEntries) {
        if (!entry.isDirectory() || !entry.name.startsWith("Proton")) {
          continue;
        }

        const candidatePath = path.join(steamCommonPath, entry.name);

        if (!isValidProtonDirectory(candidatePath)) {
          continue;
        }

        const realPath = await fs.promises.realpath(candidatePath);

        versions.push({
          name: getVersionName(realPath),
          path: realPath,
          source: "steam",
        });
      }
    }

    for (const compatibilityToolPath of compatibilityToolPaths) {
      if (!fs.existsSync(compatibilityToolPath)) {
        continue;
      }

      const compatibilityToolEntries = await fs.promises
        .readdir(compatibilityToolPath, { withFileTypes: true })
        .catch(() => [] as fs.Dirent[]);

      for (const entry of compatibilityToolEntries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const candidatePath = path.join(compatibilityToolPath, entry.name);

        if (!isValidProtonDirectory(candidatePath)) {
          continue;
        }

        const realPath = await fs.promises.realpath(candidatePath);

        versions.push({
          name: getVersionName(realPath),
          path: realPath,
          source: "compatibility_tools",
        });
      }
    }

    const uniqueVersions = new Map<string, ProtonVersion>();

    for (const version of versions) {
      uniqueVersions.set(version.path, version);
    }

    return Array.from(uniqueVersions.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  public static async preparePrefix(options: {
    winePrefixPath: string;
    protonPath?: string | null;
    gameId?: string | null;
  }): Promise<void> {
    const umuLogPath = getUmuLogPath();
    const umuBinaryPath = getUmuBinaryPath();
    const pythonPath = getCompatiblePythonPath();
    const command = pythonPath ?? umuBinaryPath;
    const args = pythonPath
      ? [umuBinaryPath, "createprefix"]
      : ["createprefix"];
    const launchEnv = {
      WINEPREFIX: options.winePrefixPath,
      ...(options.gameId ? { GAMEID: `umu-${options.gameId}` } : {}),
      ...(options.protonPath ? { PROTONPATH: options.protonPath } : {}),
    };

    rotateUmuLogIfNeeded(umuLogPath);
    fs.mkdirSync(path.dirname(umuLogPath), { recursive: true });
    fs.mkdirSync(path.dirname(options.winePrefixPath), { recursive: true });
    ensureExecutablePermission(umuBinaryPath);
    fs.appendFileSync(
      umuLogPath,
      `\n[${new Date().toISOString()}] Preparing Wine prefix with umu-run\n`
    );

    logger.info("Preparing Wine prefix with umu-run", {
      command,
      args,
      env: launchEnv,
      umuLogPath,
    });

    await new Promise<void>((resolve, reject) => {
      const shouldPipeToTerminal = is.dev;
      const logFileDescriptor = shouldPipeToTerminal
        ? null
        : fs.openSync(umuLogPath, "a");
      let settled = false;

      const closeLogFileDescriptor = () => {
        if (!settled && logFileDescriptor !== null) {
          fs.closeSync(logFileDescriptor);
        }
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        closeLogFileDescriptor();
        settled = true;
        callback();
      };
      const child = spawn(command, args, {
        detached: false,
        stdio: shouldPipeToTerminal
          ? "inherit"
          : ["ignore", logFileDescriptor, logFileDescriptor],
        shell: false,
        cwd: SystemPath.getPath("home"),
        env: {
          ...process.env,
          ...launchEnv,
        },
      });

      child.once("error", (error) => {
        finish(() => {
          logger.error("Failed to start umu-run prefix preparation", {
            errorName: error.name,
            errorMessage: error.message,
            umuLogPath,
          });
          reject(error);
        });
      });
      child.once("close", (code, signal) => {
        finish(() => {
          let prefixValid = false;

          try {
            prefixValid = Wine.validatePrefix(options.winePrefixPath);
          } catch {
            prefixValid = false;
          }

          const evaluation = evaluateUmuPrefixPreparation(
            code,
            signal,
            prefixValid
          );
          if (evaluation.success) {
            if (evaluation.acceptedNonZeroExit) {
              logger.warn(
                "umu-run returned a non-zero exit after preparing a valid prefix",
                {
                  code,
                  signal,
                  prefixValid,
                  umuLogPath,
                }
              );
            }
            resolve();
            return;
          }

          logger.error("umu-run failed to prepare a valid Wine prefix", {
            code,
            signal,
            prefixValid,
            umuLogPath,
            errorMessage: evaluation.errorMessage,
          });
          reject(new Error(evaluation.errorMessage));
        });
      });
    });
  }

  /**
   * Runs a winetricks verb inside the prefix through umu-run (`umu-run
   * winetricks <verb>`): umu executes it within the Steam Runtime
   * container using the bundled protonfixes winetricks and skips verbs
   * already present in the prefix's winetricks.log. Used to seed the
   * VC++ runtime for Online-Fix sessions.
   */
  public static async runWinetricksVerb(options: {
    winePrefixPath: string;
    protonPath?: string | null;
    gameId?: string | null;
    verb: string;
    timeoutMs?: number;
  }): Promise<boolean> {
    const timeoutMs = options.timeoutMs ?? 180_000;
    const umuLogPath = getUmuLogPath();
    const umuBinaryPath = getUmuBinaryPath();
    const pythonPath = getCompatiblePythonPath();
    const command = pythonPath ?? umuBinaryPath;
    const args = pythonPath
      ? [umuBinaryPath, "winetricks", options.verb]
      : ["winetricks", options.verb];
    const launchEnv = {
      WINEPREFIX: options.winePrefixPath,
      ...(options.gameId ? { GAMEID: `umu-${options.gameId}` } : {}),
      ...(options.protonPath ? { PROTONPATH: options.protonPath } : {}),
    };

    rotateUmuLogIfNeeded(umuLogPath);
    fs.mkdirSync(path.dirname(umuLogPath), { recursive: true });
    fs.mkdirSync(path.dirname(options.winePrefixPath), { recursive: true });
    ensureExecutablePermission(umuBinaryPath);
    fs.appendFileSync(
      umuLogPath,
      `\n[${new Date().toISOString()}] Running winetricks verb: ${options.verb}\n`
    );

    return new Promise<boolean>((resolve) => {
      const shouldPipeToTerminal = is.dev;
      const logFileDescriptor = shouldPipeToTerminal
        ? null
        : fs.openSync(umuLogPath, "a");
      let settled = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (logFileDescriptor !== null) fs.closeSync(logFileDescriptor);
        resolve(result);
      };

      timeoutHandle = setTimeout(() => finish(false), timeoutMs);

      const child = spawn(command, args, {
        detached: false,
        stdio: shouldPipeToTerminal
          ? "inherit"
          : ["ignore", logFileDescriptor, logFileDescriptor],
        shell: false,
        cwd: SystemPath.getPath("home"),
        env: {
          ...process.env,
          ...launchEnv,
        },
      });

      child.once("error", (error) => {
        logger.error("umu-run winetricks verb failed to start", {
          verb: options.verb,
          error,
        });
        finish(false);
      });

      child.once("close", (code) => {
        fs.appendFileSync(
          umuLogPath,
          `[${new Date().toISOString()}] winetricks ${options.verb} exited with code=${code ?? "null"}\n`
        );
        finish(code === 0);
      });
    });
  }

  public static async launchExecutable(
    executablePath: string,
    launchParameters: string[] = [],
    options?: {
      winePrefixPath?: string | null;
      protonPath?: string | null;
      gameId?: string | null;
      launchOptions?: string | null;
      /** Catalog launch flag ids saved on the game record (see @shared/launch-flags). */
      launchFlags?: string[] | null;
      useMangohud?: boolean;
      useGamemode?: boolean;
      /** Extra environment variables appended last (e.g. Online-Fix mode). */
      extraEnv?: Record<string, string>;
    }
  ): Promise<void> {
    const QUICK_EXIT_THRESHOLD_MS = 3000;
    const workingDirectory = path.dirname(executablePath);
    const umuLogPath = getUmuLogPath();
    const umuBinaryPath = getUmuBinaryPath();
    const pythonPath = getCompatiblePythonPath();
    const executableToSpawn = pythonPath ?? umuBinaryPath;
    const executableArgs = pythonPath
      ? [umuBinaryPath, executablePath, ...launchParameters]
      : [executablePath, ...launchParameters];

    // Catalog launch flags (ids from the game record) resolve into env
    // assignments + wrapper commands. Wrapper flags are availability-probed
    // here so a missing tool can never break the spawn; env flags are inert
    // without their consumers and always pass through. Probes only run when
    // the game actually has flags — a flagless launch must not pay for the
    // spawnSync detection. The legacy autoRunMangohud/autoRunGamemode
    // toggles keep their exact current semantics (MANGOHUD=1 env /
    // gamemoderun wrapper) and only collapse with a matching flag to avoid
    // duplicated wrappers. This is a Linux compatibility path — the Windows
    // native path never calls umu-run.
    const launchFlagToggles = mergeLegacyLaunchToggles(
      resolveLaunchFlags(
        options?.launchFlags,
        (options?.launchFlags?.length ?? 0) > 0
          ? {
              mangohud: isMangohudAvailable(),
              gamemode: isGamemodeAvailable(),
              gamescope: isGamescopeAvailable(),
            }
          : undefined
      ),
      {
        useMangohud: options?.useMangohud,
        useGamemode: options?.useGamemode,
      }
    );

    if (launchFlagToggles.unknownFlagIds.length > 0) {
      logger.warn("Ignoring unknown game launch flags", {
        executablePath,
        unknownFlagIds: launchFlagToggles.unknownFlagIds,
      });
    }

    if (launchFlagToggles.unavailableFlagIds.length > 0) {
      logger.log("Skipping launch flags whose host tools are unavailable", {
        executablePath,
        unavailableFlagIds: launchFlagToggles.unavailableFlagIds,
      });
    }

    const resolvedLaunchCommand = resolveLaunchCommand({
      baseCommand: executableToSpawn,
      baseArgs: executableArgs,
      launchOptions: options?.launchOptions,
      wrapperCommands: launchFlagToggles.wrapperCommands,
    });

    rotateUmuLogIfNeeded(umuLogPath);
    fs.mkdirSync(path.dirname(umuLogPath), { recursive: true });
    ensureExecutablePermission(umuBinaryPath);

    const launchEnv = {
      ...(options?.gameId ? { GAMEID: `umu-${options.gameId}` } : {}),
      ...(options?.winePrefixPath
        ? { WINEPREFIX: options.winePrefixPath }
        : {}),
      ...(options?.protonPath ? { PROTONPATH: options.protonPath } : {}),
      // Flag env (and the legacy MANGOHUD=1) stays below the user's
      // free-text launchOptions env: explicit user assignments win.
      ...launchFlagToggles.env,
      ...resolvedLaunchCommand.env,
      ...(options?.extraEnv ?? {}),
    };

    const envCommandPart = Object.entries(launchEnv)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ");
    const argsCommandPart = resolvedLaunchCommand.args
      .map(shellQuote)
      .join(" ");
    const launchCommand = `${envCommandPart} ${shellQuote(resolvedLaunchCommand.command)}${
      argsCommandPart ? ` ${argsCommandPart}` : ""
    }`;

    const launchHeader =
      `\n[${new Date().toISOString()}] Launching with umu-run\n` +
      `Command: ${launchCommand}\n`;

    fs.appendFileSync(umuLogPath, launchHeader);

    logger.info("Launching game with umu-run", {
      command: launchCommand,
      umuBinaryPath,
      pythonPath,
      cwd: workingDirectory,
      env: launchEnv,
      umuLogPath,
    });

    await new Promise<void>((resolve, reject) => {
      const shouldPipeToTerminal = is.dev;
      const logFileDescriptor = shouldPipeToTerminal
        ? null
        : fs.openSync(umuLogPath, "a");

      let settled = false;

      const closeLogFileDescriptor = () => {
        if (logFileDescriptor !== null) {
          fs.closeSync(logFileDescriptor);
        }
      };

      const finalize = (callback: () => void) => {
        if (settled) return;
        settled = true;
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
            ...launchEnv,
          },
        }
      );

      let quickExitTimer: NodeJS.Timeout | null = null;

      child.once("spawn", () => {
        quickExitTimer = setTimeout(() => {
          finalize(() => {
            child.unref();
            closeLogFileDescriptor();
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
          closeLogFileDescriptor();
          const earlyExitError = new Error(
            `umu-run exited early with code=${code ?? "null"} signal=${signal ?? "null"}`
          );
          fs.appendFileSync(
            umuLogPath,
            `[${new Date().toISOString()}] ${earlyExitError.message}\n`
          );
          reject(earlyExitError);
        });
      });

      child.once("error", (error) => {
        if (quickExitTimer) {
          clearTimeout(quickExitTimer);
          quickExitTimer = null;
        }

        finalize(() => {
          closeLogFileDescriptor();
          fs.appendFileSync(
            umuLogPath,
            `[${new Date().toISOString()}] Failed to spawn umu-run (${resolvedLaunchCommand.command}): ${String(error)}\n`
          );
          reject(error);
        });
      });
    });
  }
}
