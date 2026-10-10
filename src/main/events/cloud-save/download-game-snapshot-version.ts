import { BrowserWindow, dialog, shell } from "electron";

import { downloadGameSnapshotVersionToFolder } from "@main/services/cloud-save";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "downloadGameSnapshotVersion",
  async (
    event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    version: number
  ) => {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Invalid snapshot version");
    }

    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const suggestedName = `${(game?.title ?? objectId)
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()}-saves-v${version}`;

    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(
      parentWindow ?? ({} as Electron.BaseWindow),
      {
        defaultPath: suggestedName,
        nameFieldLabel: "Folder name",
        buttonLabel: "Export here",
        properties: ["createDirectory", "showOverwriteConfirmation"],
      }
    );
    if (canceled || !filePath) return null;

    const result = await downloadGameSnapshotVersionToFolder(
      objectId,
      shop,
      version,
      filePath,
      (processed, total) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("on-snapshot-version-download-progress", {
            objectId,
            shop,
            version,
            processedFiles: processed,
            totalFiles: total,
          });
        }
      }
    );

    void shell.openPath(filePath);
    return result;
  }
);
