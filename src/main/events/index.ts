import {
  appVersion,
  defaultDownloadsPath,
  isStaging,
  screenshotsPath,
} from "@main/constants";
import { ipcMain } from "electron";
import path from "node:path";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

import "./auth";
import "./autoupdater";
import "./catalogue";
import "./cloud-save";
import "./connectivity";
import "./download-sources";
import "./hardware";
import "./library";
import "./leveldb";
import "./main-window-controls";
import "./misc";
import "./notifications";
import "./profile";
import "./torrenting";
import "./user";
import "./user-preferences";
import "./library/transfer-game-files";

ipcMain.handle("ping", () => "pong");
ipcMain.handle("getVersion", () => appVersion);
ipcMain.handle("isStaging", () => isStaging);
ipcMain.handle("getDefaultDownloadsPath", () => defaultDownloadsPath);
ipcMain.handle("getScreenshotsPath", async () => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const trimmedPath = userPreferences?.achievementScreenshotsPath?.trim();

  if (trimmedPath && path.isAbsolute(trimmedPath)) {
    return path.normalize(trimmedPath);
  }

  return screenshotsPath;
});
ipcMain.handle("getCloudIframeUrl", () =>
  new URL("/cloud", import.meta.env.MAIN_VITE_CHECKOUT_URL).toString()
);
