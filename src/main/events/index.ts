import { appVersion, defaultDownloadsPath, isStaging } from "@main/constants";
import { ipcMain } from "electron";

import "./autoupdater";
import "./auth";
import "./catalogue";
import "./cloud-save";
import "./download-sources";
import "./hardware";
import "./library";
import "./leveldb";
import "./main-window-controls";
import "./misc";
import "./profile";
import "./torrenting";
import "./user";
import "./user-preferences";
import "./connectivity";
import "./library/transfer-game-files";

ipcMain.handle("ping", () => "pong");
ipcMain.handle("getVersion", () => appVersion);
ipcMain.handle("isStaging", () => isStaging);
ipcMain.handle("getDefaultDownloadsPath", () => defaultDownloadsPath);
