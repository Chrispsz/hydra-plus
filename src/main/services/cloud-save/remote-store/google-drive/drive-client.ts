import { isAxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
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

export const HYDRA_PLUS_ROOT_FOLDER_NAME = "Hydra Plus Saves";

const escapeDriveQuery = (value: string) => value.replace(/'/g, "\\'");

const authedRequest = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
  const token = await getValidGoogleDriveAccessToken();

  try {
    return await axios.request({
      ...config,
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
    const reason = (error.response?.data as
      | { error?: { errors?: Array<{ reason?: string }> } }
      | undefined)?.error?.errors?.[0]?.reason;

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

  try {
    const session = await axios.request<{ headers: Record<string, string> }>({
      url: `${DRIVE_UPLOAD_API}/files`,
      method: "POST",
      params: { uploadType: "resumable", fields: "id" },
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

    const { data } = await axios.request<{ id: string }>({
      url: uploadUrl,
      method: "PUT",
      headers: { "Content-Length": size },
      data: body,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return data.id;
  } catch (error) {
    throw toDriveError(error);
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
  try {
    const response = await authedRequest({
      url: `${DRIVE_API}/files/${fileId}`,
      params: { alt: "media" },
      responseType: "stream",
    });
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await pipeline(
      response.data as NodeJS.ReadableStream,
      fs.createWriteStream(destinationPath)
    );
  } catch (error) {
    throw toDriveError(error);
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

export const resetFolderStructureCache = () => {
  folderStructure = null;
};
