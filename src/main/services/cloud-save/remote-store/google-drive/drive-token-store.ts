import { safeStorage } from "electron";
import axios from "axios";
import { db, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";

import { getGoogleClientId } from "./config";

/**
 * Persistence for Google OAuth tokens.
 *
 * The refresh token is the long-lived credential to the user's Drive: it is
 * encrypted with the OS-provided safeStorage (DPAPI on Windows, libsecret on
 * Linux, Keychain on macOS) before touching LevelDB. If the system has no
 * keyring available we degrade to base64 obfuscation with an explicit flag
 * so the user can be warned in the UI (documented limitation).
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EXPIRATION_OFFSET_IN_MS = 5 * 60 * 1000;

export interface GoogleDriveTokensRecord {
  encryptedRefreshToken: string;
  accessToken: string;
  expirationTimestamp: number;
  plaintextFallback?: boolean;
}

interface EncryptedSecret {
  payload: string;
  plaintextFallback: boolean;
}

const encryptSecret = (value: string): EncryptedSecret => {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      payload: safeStorage.encryptString(value).toString("base64"),
      plaintextFallback: false,
    };
  }

  logger.warn(
    "safeStorage unavailable: Google Drive refresh token stored with base64 obfuscation only"
  );
  return {
    payload: Buffer.from(value, "utf8").toString("base64"),
    plaintextFallback: true,
  };
};

const decryptSecret = (payload: string, plaintextFallback: boolean): string =>
  plaintextFallback
    ? Buffer.from(payload, "base64").toString("utf8")
    : safeStorage.decryptString(Buffer.from(payload, "base64"));

const readTokens = async (): Promise<GoogleDriveTokensRecord | null> =>
  db
    .get<string, GoogleDriveTokensRecord | null>(
      levelKeys.googleDriveOAuth,
      { valueEncoding: "json" }
    )
    .catch(() => null);

export const isGoogleDriveLinked = async (): Promise<boolean> => {
  const tokens = await readTokens();
  return Boolean(tokens?.encryptedRefreshToken);
};

export const saveGoogleDriveTokens = async (tokens: {
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}): Promise<void> => {
  const { payload, plaintextFallback } = encryptSecret(tokens.refreshToken);

  await db.put<string, GoogleDriveTokensRecord>(
    levelKeys.googleDriveOAuth,
    {
      encryptedRefreshToken: payload,
      accessToken: tokens.accessToken,
      expirationTimestamp:
        Date.now() + tokens.expiresIn * 1000 - EXPIRATION_OFFSET_IN_MS,
      ...(plaintextFallback ? { plaintextFallback: true } : {}),
    },
    { valueEncoding: "json" }
  );
};

export const getGoogleDriveRefreshToken = async (): Promise<string | null> => {
  const tokens = await readTokens();
  if (!tokens?.encryptedRefreshToken) return null;

  try {
    return decryptSecret(
      tokens.encryptedRefreshToken,
      Boolean(tokens.plaintextFallback)
    );
  } catch (error) {
    logger.error("Failed to decrypt Google Drive refresh token", error);
    return null;
  }
};

export const clearGoogleDriveTokens = async (): Promise<void> => {
  await db.delete(levelKeys.googleDriveOAuth).catch(() => {});
};

let refreshInFlight: Promise<string> | null = null;

const requestFreshAccessToken = async (): Promise<string> => {
  const tokens = await readTokens();
  const refreshToken = await getGoogleDriveRefreshToken();

  if (!tokens?.encryptedRefreshToken || !refreshToken) {
    throw new Error("google_drive_not_linked");
  }

  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      client_id: getGoogleClientId(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
  );

  await db.put<string, GoogleDriveTokensRecord>(
    levelKeys.googleDriveOAuth,
    {
      encryptedRefreshToken: tokens.encryptedRefreshToken,
      accessToken: data.access_token,
      expirationTimestamp:
        Date.now() + data.expires_in * 1000 - EXPIRATION_OFFSET_IN_MS,
      ...(tokens.plaintextFallback ? { plaintextFallback: true } : {}),
    },
    { valueEncoding: "json" }
  );

  return data.access_token;
};

/** Returns a valid access token, refreshing it when expired (single-flight). */
export const getValidGoogleDriveAccessToken = async (): Promise<string> => {
  const tokens = await readTokens();
  if (!tokens?.encryptedRefreshToken) {
    throw new Error("google_drive_not_linked");
  }

  if (Date.now() < tokens.expirationTimestamp) {
    return tokens.accessToken;
  }

  if (!refreshInFlight) {
    refreshInFlight = requestFreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
};

/** Forces a refresh even if the cached token looks valid (401 recovery). */
export const forceRefreshGoogleDriveAccessToken = async (): Promise<string> =>
  requestFreshAccessToken();
