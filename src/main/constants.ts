import { app } from "electron";
import path from "node:path";
import { SystemPath } from "./services/system-path";

/**
 * Default games library directory.
 * Deliberately NOT the OS "Downloads" folder: games are large, folder-polluting
 * content. Fresh installs point to a dedicated per-user games directory.
 * Existing user preferences are never overridden.
 */
export const defaultDownloadsPath = path.join(
  SystemPath.getPath("home"),
  "Games",
  "Hydra"
);

export const isStaging = import.meta.env.MAIN_VITE_API_URL.includes("staging");

/**
 * Set to "1" by the debug release workflow and `build:linux:debug`.
 * Debug builds ship a live debug console, skip auto-updates and use an
 * isolated productName/userData so they can run next to the stable install.
 */
export const IS_DEBUG_BUILD = import.meta.env.MAIN_VITE_DEBUG_BUILD === "1";

export const windowsStartMenuPath = path.join(
  SystemPath.getPath("appData"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs"
);

export const publicProfilePath = "C:/Users/Public";

export const levelDatabasePath = path.join(
  SystemPath.getPath("userData"),
  `hydra-db${isStaging ? "-staging" : ""}`
);

export const commonRedistPath = path.join(
  SystemPath.getPath("userData"),
  "CommonRedist"
);

export const logsPath = path.join(
  SystemPath.getPath("userData"),
  `logs${isStaging ? "-staging" : ""}`
);

export const screenshotsPath = path.join(
  SystemPath.getPath("userData"),
  "Screenshots"
);

export const backupsPath = path.join(SystemPath.getPath("userData"), "Backups");

export const appVersion = app.getVersion() + (isStaging ? "-staging" : "");

export const ASSETS_PATH = path.join(SystemPath.getPath("userData"), "Assets");

export const INTERVALS = {
  processWatcher: 2_000,
  downloadWatcher: 2_000,
  seedStatusWatcher: 2_000,
  updateChecker: 60_000 * 50, // 50 minutes
  powerSaveBlockerSync: 20_000,
};

export const DECKY_PLUGINS_LOCATION = path.join(
  SystemPath.getPath("home"),
  "homebrew",
  "plugins"
);

export const HYDRA_DECKY_PLUGIN_LOCATION = path.join(
  DECKY_PLUGINS_LOCATION,
  "Hydra"
);
