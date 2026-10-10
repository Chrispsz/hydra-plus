import { appVersion, defaultDownloadsPath, isStaging } from "@main/constants";
import { ipcMain } from "electron";

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
ipcMain.handle("getCloudIframeUrl", () =>
  new URL("/cloud", import.meta.env.MAIN_VITE_CHECKOUT_URL).toString()
);
