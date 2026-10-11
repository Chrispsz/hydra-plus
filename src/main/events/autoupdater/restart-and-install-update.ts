import { app } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";

const { autoUpdater } = updater;

export const restartAndInstallUpdate = () => {
  // Windows portable updates go through the portable updater
  // (applyPortableUpdate) — electron-updater has nothing to install here.
  if (
    process.platform === "win32" &&
    process.env.PORTABLE_EXECUTABLE_FILE != null
  ) {
    return;
  }

  autoUpdater.removeAllListeners();
  if (app.isPackaged) {
    autoUpdater.quitAndInstall(false);
  }
};

const restartAndInstallUpdateEvent = async (
  _event: Electron.IpcMainInvokeEvent
) => restartAndInstallUpdate();

registerEvent("restartAndInstallUpdate", restartAndInstallUpdateEvent);
