import { safeStorage } from "electron";
import axios, { isAxiosError } from "axios";
import { db, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";

import { resolveGoogleClientId } from "./config";

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
    .get<
      string,
      GoogleDriveTokensRecord | null
    >(levelKeys.googleDriveOAuth, { valueEncoding: "json" })
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
  await db.del(levelKeys.googleDriveOAuth).catch(() => {});
};

let refreshInFlight: Promise<string> | null = null;

/**
 * Maps a failed refresh-token exchange to a user-actionable error kind.
 *
 * Google answers 400 with `invalid_grant` when the refresh token was
 * revoked or expired (OAuth consent screens in "Testing" mode expire
 * refresh tokens after 7 days). Without this mapping every Drive call
 * surfaced as a generic failure and the only hint was "try again" —
 * which could never fix a dead refresh token.
 */
const toTokenRefreshError = (error: unknown): Error => {
  if (isAxiosError(error) && error.response) {
    const { status, data } = error.response;
    const googleError =
      (data as { error?: string } | undefined)?.error ?? undefined;

    if (
      status === 400 ||
      status === 401 ||
      googleError === "invalid_grant" ||
      googleError === "unauthorized_client"
    ) {
      return new Error("google_drive_reauth_required");
    }
  }

  return error instanceof Error ? error : new Error("google_drive_error");
};

const requestFreshAccessToken = async (): Promise<string> => {
  const tokens = await readTokens();
  const refreshToken = await getGoogleDriveRefreshToken();

  if (!tokens?.encryptedRefreshToken) {
    throw new Error("google_drive_not_linked");
  }

  if (!refreshToken) {
    // The record exists but the refresh token could not be recovered
    // (e.g. safeStorage cannot decrypt it in this session). The user
    // still thinks the account is linked, so ask for a reconnect.
    throw new Error("google_drive_reauth_required");
  }

  let data: { access_token: string; expires_in: number };
  try {
    ({ data } = await axios.post<{
      access_token: string;
      expires_in: number;
    }>(
      TOKEN_ENDPOINT,
      new URLSearchParams({
        client_id: await resolveGoogleClientId(),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      })
    ));
  } catch (error) {
    logger.error("Google Drive token refresh failed", error);
    throw toTokenRefreshError(error);
  }

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

/** True when the stored refresh token lacks OS-level encryption. */
export const isGoogleDriveTokenPlaintextFallback =
  async (): Promise<boolean> => {
    const tokens = await readTokens();
    return Boolean(tokens?.plaintextFallback);
  };
