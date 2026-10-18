import axios, {
  isAxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { logger } from "@main/services/logger";

import {
  forceRefreshGoogleDriveAccessToken,
  getValidGoogleDriveAccessToken,
} from "./drive-token-store";

/**
 * Minimal Google Drive v3 REST client (no SDK dependency).
 *
 * Every call goes through `authedRequest`, which attaches the Bearer token
 * and recovers once from a 401 by force-refreshing it. Only the handful of
 * endpoints the cloud-save provider needs are wrapped.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_REQUEST_TIMEOUT_MS = 60_000;
const DRIVE_INACTIVITY_TIMEOUT_MS = 90_000;

export const HYDRA_PLUS_ROOT_FOLDER_NAME = "Hydra Plus Saves";

const escapeDriveQuery = (value: string) => value.replace(/'/g, "\\'");

/**
 * Aborts large transfers that stop making progress instead of enforcing a
 * total deadline: the timer is rearmed on every upload/download progress
 * event, so slow-but-alive transfers survive while dead sockets do not.
 */
const createInactivityWatchdog = () => {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = setTimeout(
    () => controller.abort(),
    DRIVE_INACTIVITY_TIMEOUT_MS
  );

  return {
    signal: controller.signal,
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), DRIVE_INACTIVITY_TIMEOUT_MS);
    },
    clear: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};

const authedRequest = async (
  config: AxiosRequestConfig
): Promise<AxiosResponse> => {
  const token = await getValidGoogleDriveAccessToken();

  try {
    return await axios.request({
      ...config,
      timeout: config.timeout ?? DRIVE_REQUEST_TIMEOUT_MS,
      headers: {
        ...(config.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 401) {
      const refreshed = await forceRefreshGoogleDriveAccessToken();
      return axios.request({
        ...config,
        timeout: config.timeout ?? DRIVE_REQUEST_TIMEOUT_MS,
        headers: {
          ...(config.headers ?? {}),
          Authorization: `Bearer ${refreshed}`,
        },
      });
    }
    throw error;
  }
};

const toDriveError = (error: unknown): Error => {
  if (isAxiosError(error)) {
    const reason = (
      error.response?.data as
        | { error?: { errors?: Array<{ reason?: string }> } }
        | undefined
    )?.error?.errors?.[0]?.reason;

    if (reason === "storageQuotaExceeded") {
      return new Error("google_drive_quota_exceeded");
    }
    if (error.response?.status === 403) {
      return new Error("google_drive_forbidden");
    }
  }
  return error instanceof Error ? error : new Error("google_drive_error");
};

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
}

/** Finds a direct child of `parentId` by exact name (files or folders). */
export const findChildByName = async (
  parentId: string,
  name: string
): Promise<DriveFileEntry | null> => {
  const query =
    `name = '${escapeDriveQuery(name)}' and ` +
    `'${escapeDriveQuery(parentId)}' in parents and trashed = false`;

  try {
    const { data } = await authedRequest({
      url: `${DRIVE_API}/files`,
      params: {
        q: query,
        spaces: "drive",
        fields: "files(id,name,mimeType,modifiedTime)",
        pageSize: 10,
      },
    });
    return (data.files as DriveFileEntry[])[0] ?? null;
  } catch (error) {
    throw toDriveError(error);
  }
};

export interface DriveFileMetadata extends DriveFileEntry {
  size?: string;
  appProperties?: Record<string, string>;
}

/**
 * Lists every direct child of a folder, following page tokens. Only the
 * fields the hygiene/version tooling needs are requested.
 */
export const listAllChildren = async (
  parentId: string
): Promise<DriveFileMetadata[]> => {
  const query = `'${escapeDriveQuery(parentId)}' in parents and trashed = false`;
  const all: DriveFileMetadata[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const { data } = await authedRequest({
        url: `${DRIVE_API}/files`,
        params: {
          q: query,
          spaces: "drive",
          fields:
            "nextPageToken, files(id,name,mimeType,modifiedTime,size,appProperties)",
          pageSize: 200,
          ...(pageToken ? { pageToken } : {}),
        },
      });
      all.push(...((data.files as DriveFileMetadata[]) ?? []));
      pageToken = data.nextPageToken as string | undefined;
    } while (pageToken);
  } catch (error) {
    throw toDriveError(error);
  }

  return all;
};

/**
 * Lists every app-visible file currently in the Drive trash (drive.file
 * scope means only files this app created are visible, trashed or not).
 */
export const listAllTrashedFiles = async (): Promise<DriveFileMetadata[]> => {
  const all: DriveFileMetadata[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const { data } = await authedRequest({
        url: `${DRIVE_API}/files`,
        params: {
          q: "trashed = true",
          spaces: "drive",
          fields: "nextPageToken, files(id,name,mimeType,modifiedTime,size)",
          pageSize: 200,
          ...(pageToken ? { pageToken } : {}),
        },
      });
      all.push(...((data.files as DriveFileMetadata[]) ?? []));
      pageToken = data.nextPageToken as string | undefined;
    } while (pageToken);
  } catch (error) {
    throw toDriveError(error);
  }

  return all;
};

/** Permanently deletes a file (skips the trash). */
export const deleteFileForever = async (fileId: string): Promise<void> => {
  try {
    await authedRequest({
      url: `${DRIVE_API}/files/${fileId}`,
      method: "DELETE",
    });
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return;
    throw toDriveError(error);
  }
};

const createFolder = async (
  name: string,
  parentId: string
): Promise<string> => {
  const { data } = await authedRequest({
    url: `${DRIVE_API}/files`,
    method: "POST",
    params: { fields: "id" },
    data: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
  });
  logger.log(`Created Drive folder "${name}"`, data.id);
  return data.id as string;
};

export const ensureFolder = async (
  name: string,
  parentId: string
): Promise<string> => {
  const existing = await findChildByName(parentId, name);
  if (existing && existing.mimeType === FOLDER_MIME) return existing.id;
  if (existing) {
    throw new Error(`google_drive_path_conflict:${name}`);
  }
  return createFolder(name, parentId);
};

export interface DriveFolderStructure {
  rootId: string;
  blobsId: string;
  gamesId: string;
}

let folderStructure: DriveFolderStructure | null = null;

/** Ensures `Hydra Plus Saves/{blobs,games}` and memoizes the ids per session. */
export const ensureRootStructure = async (): Promise<DriveFolderStructure> => {
  if (folderStructure) return folderStructure;

  const rootId = await ensureFolder(HYDRA_PLUS_ROOT_FOLDER_NAME, "root");
  const blobsId = await ensureFolder("blobs", rootId);
  const gamesId = await ensureFolder("games", rootId);

  folderStructure = { rootId, blobsId, gamesId };
  return folderStructure;
};

export interface UploadFileInput {
  name: string;
  parentId: string;
  mimeType: string;
  appProperties?: Record<string, string>;
  sourcePath?: string;
  content?: Buffer;
}

/**
 * Resumable upload (single PUT). Supports a file stream or an in-memory
 * buffer; returns the new file id.
 */
export const uploadFile = async (input: UploadFileInput): Promise<string> => {
  const token = await getValidGoogleDriveAccessToken();
  const watchdog = createInactivityWatchdog();

  try {
    const session = await axios.request<{ headers: Record<string, string> }>({
      url: `${DRIVE_UPLOAD_API}/files`,
      method: "POST",
      params: { uploadType: "resumable", fields: "id" },
      timeout: DRIVE_REQUEST_TIMEOUT_MS,
      signal: watchdog.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      data: {
        name: input.name,
        mimeType: input.mimeType,
        parents: [input.parentId],
        ...(input.appProperties ? { appProperties: input.appProperties } : {}),
      },
    });

    const uploadUrl = session.headers.location;
    if (!uploadUrl) throw new Error("google_drive_upload_session_missing");

    const size = input.sourcePath
      ? (await fs.promises.stat(input.sourcePath)).size
      : (input.content as Buffer).length;
    const body = input.sourcePath
      ? fs.createReadStream(input.sourcePath)
      : (input.content as Buffer);

    watchdog.reset();

    const { data } = await axios.request<{ id: string }>({
      url: uploadUrl,
      method: "PUT",
      headers: { "Content-Length": size },
      data: body,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      signal: watchdog.signal,
      onUploadProgress: watchdog.reset,
    });

    return data.id;
  } catch (error) {
    throw toDriveError(error);
  } finally {
    watchdog.clear();
  }
};

/** Replaces the content of an existing file. */
export const updateFileContent = async (
  fileId: string,
  content: Buffer,
  mimeType = "application/json"
): Promise<void> => {
  try {
    await authedRequest({
      url: `${DRIVE_UPLOAD_API}/files/${fileId}`,
      method: "PATCH",
      params: { uploadType: "media" },
      headers: { "Content-Type": mimeType },
      data: content,
      maxBodyLength: Infinity,
    });
  } catch (error) {
    throw toDriveError(error);
  }
};

export const readFileJson = async <T>(fileId: string): Promise<T> => {
  try {
    const { data } = await authedRequest({
      url: `${DRIVE_API}/files/${fileId}`,
      params: { alt: "media" },
      responseType: "json",
    });
    return data as T;
  } catch (error) {
    throw toDriveError(error);
  }
};

export const downloadFileToFile = async (
  fileId: string,
  destinationPath: string
): Promise<void> => {
  const watchdog = createInactivityWatchdog();

  try {
    const response = await authedRequest({
      url: `${DRIVE_API}/files/${fileId}`,
      params: { alt: "media" },
      responseType: "stream",
      timeout: 0,
      signal: watchdog.signal,
      onDownloadProgress: watchdog.reset,
    });
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await pipeline(
      response.data as NodeJS.ReadableStream,
      fs.createWriteStream(destinationPath)
    );
  } catch (error) {
    throw toDriveError(error);
  } finally {
    watchdog.clear();
  }
};

export const trashFile = async (fileId: string): Promise<void> => {
  try {
    await authedRequest({
      url: `${DRIVE_API}/files/${fileId}`,
      method: "PATCH",
      data: { trashed: true },
    });
  } catch (error) {
    throw toDriveError(error);
  }
};

/** Returns the e-mail of the linked Drive account (about.get). */
export const getDriveAccountEmail = async (): Promise<string | null> => {
  try {
    const { data } = await authedRequest({
      url: `${DRIVE_API}/about`,
      params: { fields: "user" },
    });
    const user = (data as { user?: { emailAddress?: string } }).user;
    return user?.emailAddress ?? null;
  } catch (error) {
    logger.warn("Failed to resolve Google Drive account e-mail", error);
    return null;
  }
};

/**
 * One-shot health check used right after linking: confirms the token works
 * AND that the Google Drive API is enabled on the OAuth client's project.
 * Only a definitive "API disabled" rejection blocks the link — any other
 * probe hiccup is logged and tolerated so linking never fails spuriously.
 */
export const probeGoogleDriveAccess = async (): Promise<void> => {
  try {
    await authedRequest({
      url: `${DRIVE_API}/about`,
      params: { fields: "user" },
    });
  } catch (error) {
    if (isAxiosError(error)) {
      const message = (
        error.response?.data as { error?: { message?: string } } | undefined
      )?.error?.message?.trim();

      if (error.response?.status === 403 && message) {
        if (/has not been used|is disabled|disabled/i.test(message)) {
          throw new Error("google_drive_api_disabled");
        }
        logger.warn(
          "Google Drive probe rejected with 403, tolerating:",
          message
        );
        return;
      }

      logger.warn(
        "Google Drive probe failed (non-blocking):",
        error.response?.status ?? error.message
      );
      return;
    }
    throw error;
  }
};

export const resetFolderStructureCache = () => {
  folderStructure = null;
};
