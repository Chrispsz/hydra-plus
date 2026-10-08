import { shell } from "electron";
import http from "node:http";
import crypto from "node:crypto";
import axios from "axios";
import { logger } from "@main/services/logger";

import {
  clearGoogleDriveTokens,
  getGoogleDriveRefreshToken,
  saveGoogleDriveTokens,
} from "./drive-token-store";
import { probeGoogleDriveAccess } from "./drive-client";
import { resolveGoogleClientId, resolveGoogleClientSecret } from "./config";

/**
 * Google OAuth 2.0 for installed apps (PKCE + loopback redirect).
 *
 * Uses the system browser (Google blocks embedded webviews) and captures
 * the authorization code on a one-shot 127.0.0.1 listener, so no deep link
 * registration is required. Scopes are minimal: drive.file only — the app
 * can see and manage exclusively the files it created.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const base64url = (buffer: Buffer) => buffer.toString("base64url");

interface TokenExchangeResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

export const startGoogleDriveAuth = async (): Promise<{ linked: true }> => {
  const [clientId, clientSecret] = await Promise.all([
    resolveGoogleClientId(),
    resolveGoogleClientSecret(),
  ]);

  if (!clientId) {
    throw new Error("google_oauth_client_id_missing");
  }
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  const state = base64url(crypto.randomBytes(16));

  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const returnedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<html><body style='font-family:sans-serif;background:#1c1c1c;color:#c5c5c5;display:flex;align-items:center;justify-content:center;height:100vh'><p>Você já pode fechar esta janela e voltar ao Hydra Plus.</p></body></html>"
      );

      if (returnedState !== state) {
        rejectCode(new Error("google_oauth_state_mismatch"));
        return;
      }
      if (error) {
        rejectCode(new Error(`google_oauth_denied:${error}`));
        return;
      }
      if (code) {
        resolveCode(code);
      }
    } catch (parseError) {
      rejectCode(
        parseError instanceof Error
          ? parseError
          : new Error("google_oauth_callback_error")
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${port}`;

  const authorizationUrl = new URL(AUTH_ENDPOINT);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", DRIVE_SCOPE);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);
  // Always request consent so a refresh token is guaranteed on re-link.
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");

  try {
    await shell.openExternal(authorizationUrl.toString());
    logger.log("Google Drive authorization opened in the system browser");

    const code = await withTimeout(
      codePromise,
      AUTH_TIMEOUT_MS,
      "google_oauth_timeout"
    );

    // Google issues a client secret for desktop clients too; it is public
    // data for installed apps, but some projects require it on the token
    // exchange. Send it only when the user provided one.
    const tokenRequest = new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });
    if (clientSecret) tokenRequest.set("client_secret", clientSecret);

    try {
      const { data } = await axios.post<TokenExchangeResponse>(
        TOKEN_ENDPOINT,
        tokenRequest
      );

      if (!data.refresh_token) {
        throw new Error("google_oauth_refresh_token_missing");
      }

      // Fail fast with an actionable error when the OAuth client's project
      // does not have the Google Drive API enabled.
      await probeGoogleDriveAccess();

      await saveGoogleDriveTokens({
        refreshToken: data.refresh_token,
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("google_")) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const data = error.response?.data as
          | { error?: string; error_description?: string }
          | undefined;
        logger.error(
          "Google Drive token exchange failed",
          error.response?.status,
          data?.error,
          data?.error_description
        );
        throw new Error(
          `google_oauth_exchange_failed:${data?.error ?? error.code ?? "network"}`
        );
      }

      throw error;
    }

    logger.log("Google Drive account linked successfully");
    return { linked: true };
  } finally {
    server.close();
  }
};

export const disconnectGoogleDriveAccount = async (): Promise<void> => {
  const refreshToken = await getGoogleDriveRefreshToken();
  await clearGoogleDriveTokens();

  if (refreshToken) {
    await axios
      .post(REVOKE_ENDPOINT, new URLSearchParams({ token: refreshToken }))
      .catch((error) => {
        logger.warn("Failed to revoke Google Drive token", error);
      });
  }

  logger.log("Google Drive account disconnected");
};
