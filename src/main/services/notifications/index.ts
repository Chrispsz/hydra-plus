import { Notification } from "electron";
import { t } from "i18next";
import trayIcon from "@resources/tray-icon.png?asset";
import fs from "node:fs";
import axios from "axios";
import path from "node:path";
import { logger } from "../logger";
import type { Game, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { restartAndInstallUpdate } from "@main/events/autoupdater/restart-and-install-update";
import { SystemPath } from "../system-path";
import { LocalNotificationManager } from "./local-notifications";
import {
  buildDownloadFileName,
  transcodeNotificationIcon,
} from "./notification-icon";

/**
 * Icons live in a directory of our own so it can be emptied wholesale. It is
 * cleared once per run rather than per notification because Electron reads the
 * icon off disk lazily, and the app holds a single-instance lock, so no other
 * run can be relying on what is already there.
 */
let notificationIconDirectory: Promise<string> | null = null;

const getNotificationIconDirectory = () => {
  notificationIconDirectory ??= (async () => {
    const directory = path.join(
      SystemPath.getPath("temp"),
      "hydra-notifications"
    );

    await fs.promises.rm(directory, { recursive: true, force: true });
    await fs.promises.mkdir(directory, { recursive: true });

    return directory;
  })();

  return notificationIconDirectory;
};

const getStaticImage = async (imagePath: string) => {
  try {
    return await transcodeNotificationIcon(
      imagePath,
      await getNotificationIconDirectory()
    );
  } catch (error) {
    logger.error("Failed to transcode notification icon", imagePath, error);
    return undefined;
  } finally {
    // The download is only ever an input to the transcode.
    await fs.promises.unlink(imagePath).catch(() => undefined);
  }
};

async function downloadImage(url: string | null, signal?: AbortSignal) {
  if (signal?.aborted) return undefined;
  if (!url) return undefined;
  if (!url.startsWith("http")) return undefined;

  const fileName = buildDownloadFileName(url);
  const outputPath = path.join(await getNotificationIconDirectory(), fileName);
  const writer = fs.createWriteStream(outputPath);

  const response = await axios.get(url, {
    responseType: "stream",
    signal,
  });

  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const discardDownload = () =>
      fs.promises.unlink(outputPath).catch(() => undefined);
    const onAbort = () => {
      writer.destroy();
      void discardDownload();
      finish(undefined);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    writer.on("finish", async () => {
      const staticImagePath = await getStaticImage(outputPath);
      finish(signal?.aborted ? undefined : staticImagePath);
    });
    writer.on("error", () => {
      if (!signal?.aborted) logger.error("Failed to download image", { url });
      void discardDownload();
      finish(undefined);
    });
    response.data.pipe(writer);
  });
}

export const publishDownloadCompleteNotification = async (game: Game) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  const title = t("download_complete", { ns: "notifications" });
  const body = t("game_ready_to_install", {
    ns: "notifications",
    title: game.title,
  });

  if (userPreferences?.downloadNotificationsEnabled) {
    new Notification({
      title,
      body,
      icon: await downloadImage(game.iconUrl),
    }).show();
  }

  // Create local notification
  await LocalNotificationManager.createNotification(
    "DOWNLOAD_COMPLETE",
    title,
    body,
    {
      pictureUrl: game.iconUrl,
      url: `/game/${game.shop}/${game.objectId}`,
    }
  );
};

export const publishDownloadHaltedNotification = async (game: Game) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!userPreferences?.downloadNotificationsEnabled) return;

  new Notification({
    title: t("download_halted", { ns: "notifications" }),
    body: t("download_halted_no_disk_space", {
      ns: "notifications",
      title: game.title,
    }),
    icon: await downloadImage(game.iconUrl),
  }).show();
};

export const publishNotificationUpdateReadyToInstall = async (
  version: string
) => {
  const title = t("new_update_available", {
    ns: "notifications",
    version,
  });
  const body = t("restart_to_install_update", {
    ns: "notifications",
  });

  new Notification({
    title,
    body,
    icon: trayIcon,
  })
    .on("click", () => {
      restartAndInstallUpdate();
    })
    .show();

  // Create local notification
  await LocalNotificationManager.createNotification(
    "UPDATE_AVAILABLE",
    title,
    body
  );
};

export const publishExtractionCompleteNotification = async (game: Game) => {
  const title = t("extraction_complete", { ns: "notifications" });
  const body = t("game_extracted", {
    ns: "notifications",
    title: game.title,
  });

  new Notification({
    title,
    body,
    icon: trayIcon,
  }).show();

  // Create local notification
  await LocalNotificationManager.createNotification(
    "EXTRACTION_COMPLETE",
    title,
    body,
    {
      pictureUrl: game.iconUrl,
      url: `/game/${game.shop}/${game.objectId}`,
    }
  );
};
