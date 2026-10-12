import updater, { UpdateInfo } from "electron-updater";
import { logger, WindowManager } from "@main/services";
import { AppUpdaterEvent, UserPreferences } from "@types";
import { app } from "electron";
import { publishNotificationUpdateReadyToInstall } from "@main/services/notifications";
import { db, levelKeys } from "@main/level";

const { autoUpdater } = updater;
const sendEventsForDebug = false;

export class UpdateManager {
  private static hasNotified = false;
  private static newVersion = "";

  private static mockValuesForDebug() {
    this.sendEvent({ type: "update-available", info: { version: "3.3.1" } });
    this.sendEvent({ type: "update-downloaded" });
  }

  private static sendEvent(event: AppUpdaterEvent) {
    WindowManager.mainWindow?.webContents.send("autoUpdaterEvent", event);
  }

  private static async isAutoInstallEnabled() {
    if (process.platform === "darwin") return false;
    if (process.platform === "win32") {
      return process.env.PORTABLE_EXECUTABLE_FILE == null;
    }

    if (process.platform === "linux") {
      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      // AppImage updates replace the file in place, keeping settings and
      // logins — enabled by default so updates are one click.
      return userPreferences?.enableAutoInstall !== false;
    }

    return false;
  }

  public static async checkForUpdates() {
    // Windows portable: electron-updater cannot replace a portable exe (its
    // quitAndInstall is a no-op there) — the built-in portable updater owns
    // the whole flow. Skip electron-updater entirely to avoid duplicate
    // checks and bogus install prompts.
    if (
      process.platform === "win32" &&
      process.env.PORTABLE_EXECUTABLE_FILE != null
    ) {
      return false;
    }

    autoUpdater
      .removeAllListeners()
      .on("update-available", (info: UpdateInfo) => {
        this.sendEvent({ type: "update-available", info });
        this.newVersion = info.version;
      })
      .on("update-downloaded", () => {
        this.sendEvent({ type: "update-downloaded" });

        if (!this.hasNotified) {
          this.hasNotified = true;
          publishNotificationUpdateReadyToInstall(this.newVersion);
        }
      });

    const isAutoInstallAvailable = await this.isAutoInstallEnabled();

    if (app.isPackaged) {
      autoUpdater.autoDownload = isAutoInstallAvailable;
      autoUpdater
        .checkForUpdates()
        .then((result) => {
          logger.log(`Check for updates result: ${result}`);
        })
        .catch((error) => {
          logger.warn("Check for updates failed", error);
        });
    } else if (sendEventsForDebug) {
      this.mockValuesForDebug();
    }

    return isAutoInstallAvailable;
  }
}
