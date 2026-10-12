import { ipcMain } from "electron";

export const registerEvent = (
  name: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
) => {
  ipcMain.handle(name, async (event: Electron.IpcMainInvokeEvent, ...args) => {
    // Electron structured-clones IPC values already; the deep JSON clone
    // here used to cost a full copy of the library on every refresh.
    return Promise.resolve(listener(event, ...args));
  });
};
