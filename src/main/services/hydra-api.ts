import axios, { AxiosError, AxiosInstance } from "axios";
import url from "node:url";
import { networkLogger as logger } from "./logger";
import { appVersion } from "@main/constants";
import {
  sanitizeNetworkLogPayload,
  summarizeNetworkLogPayload,
} from "./network-log-payload";
import { WindowManager } from "./window-manager";
import { db } from "@main/level";
import { levelKeys } from "@main/level";
import type { Auth, UserDetails } from "@types";

declare module "axios" {
  interface AxiosRequestConfig {
    logResponseBody?: boolean;
  }
}

export interface HydraApiOptions {
  needsAuth?: boolean;
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  logResponseBody?: boolean;
}

/**
 * Hydra API client. The catalogue and download-source endpoints work
 * anonymously; signing in with a Hydra account additionally restores the
 * profile download sources (the "catálogo sincronizado") and the account
 * display. There is no social layer anymore — sessions only exist to
 * bring the user's sources over.
 */
export class HydraApi {
  private static instance: AxiosInstance;

  private static readonly ADD_LOG_INTERCEPTOR = true;
  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5; // 5 minutes

  private static userAuth: Auth = {
    accessToken: "",
    refreshToken: "",
    tokenExpirationTimestamp: 0,
  };

  static isLoggedIn() {
    return this.userAuth.accessToken !== "";
  }

  static async setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
      timeout: 20_000,
    });

    if (this.ADD_LOG_INTERCEPTOR) {
      this.instance.interceptors.request.use(
        (request) => {
          logger.log(" ---- REQUEST -----");
          logger.log(
            request.method,
            request.url,
            sanitizeNetworkLogPayload({
              params: request.params ?? null,
              data: request.data ?? null,
            })
          );
          return request;
        },
        (error) => {
          logger.error("request error", error);
          return Promise.reject(error);
        }
      );
      this.instance.interceptors.response.use(
        (response) => {
          logger.log(" ---- RESPONSE -----");
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            response.config.logResponseBody === false
              ? summarizeNetworkLogPayload(response.data)
              : sanitizeNetworkLogPayload(response.data)
          );
          return response;
        },
        (error) => {
          logger.error(" ---- RESPONSE ERROR -----");
          const config = error.config ?? {};

          logger.error(
            config.method,
            config.baseURL,
            config.url,
            sanitizeNetworkLogPayload({
              headers: config.headers ?? null,
              data: config.data ?? null,
            })
          );
          if (error.response) {
            logger.error(
              "Response error:",
              error.response.status,
              sanitizeNetworkLogPayload(error.response.data)
            );

            return Promise.reject(error as AxiosError);
          }

          if (error.request) {
            const errorData = error.toJSON();
            logger.error("Request error:", errorData.code, errorData.message);
            return Promise.reject(
              new Error(
                `Request failed with ${errorData.code} ${errorData.message}`
              )
            );
          }

          logger.error("Error", error.message);
          return Promise.reject(error as Error);
        }
      );
    }

    const auth = await db
      .get<string, Auth>(levelKeys.auth, { valueEncoding: "json" })
      .catch(() => undefined);

    this.userAuth = {
      accessToken: auth?.accessToken ?? "",
      refreshToken: auth?.refreshToken ?? "",
      tokenExpirationTimestamp: auth?.tokenExpirationTimestamp ?? 0,
    };

    // Refresh the stored profile (subscription state, avatar) when a
    // session survived the reboot — best-effort, boot never blocks.
    if (this.isLoggedIn()) {
      void this.getMe().catch(() => null);
    }
  }

  private static getInstance() {
    if (!this.instance) {
      throw new Error("HydraApi.setupApi() must run before making requests");
    }
    return this.instance;
  }

  // ---------------------------------------------------------------------------
  // Session handling
  // ---------------------------------------------------------------------------

  /**
   * Consumes the `hydralauncher://auth?payload=<base64>` deep link the
   * Hydra login page redirects to: stores the session, fetches the
   * profile and syncs the account's download sources over.
   */
  static async handleExternalAuth(uri: string) {
    const { payload } = url.parse(uri, true).query;

    const decodedBase64 = atob(payload as string);
    const jsonData = JSON.parse(decodedBase64) as {
      accessToken: string;
      expiresIn: number;
      refreshToken: string;
    };

    const { accessToken, expiresIn, refreshToken } = jsonData;

    if (!accessToken || !refreshToken) {
      logger.error("Sign in payload missing tokens — ignoring");
      return;
    }

    const tokenExpirationTimestamp =
      Date.now() + expiresIn * 1000 - this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth = {
      accessToken,
      refreshToken,
      tokenExpirationTimestamp,
    };

    logger.log(
      "Sign in received. Token expiration timestamp:",
      tokenExpirationTimestamp
    );

    await db.put<string, Auth>(
      levelKeys.auth,
      { accessToken, refreshToken, tokenExpirationTimestamp },
      { valueEncoding: "json" }
    );

    await this.getMe().catch(() => null);

    const { syncDownloadSourcesFromApi } = await import("./user");
    void syncDownloadSourcesFromApi();

    WindowManager.sendToAppWindows("on-signin");
  }

  /** Wipes the local session and notifies the app windows. */
  static async handleSignOut() {
    this.userAuth = {
      accessToken: "",
      refreshToken: "",
      tokenExpirationTimestamp: 0,
    };

    WindowManager.sendToAppWindows("on-signout");

    this.post("/auth/logout", {}, { needsAuth: true }).catch(() => {});
  }

  /** Fetches the signed-in profile, caching it in the user key. */
  static async getMe(): Promise<UserDetails | null> {
    try {
      const me = await this.get<UserDetails>("/profile/me", null, {
        needsAuth: true,
      });

      await db
        .put<string, UserDetails>(levelKeys.user, me, {
          valueEncoding: "json",
        })
        .catch(() => {});

      return me;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401) {
        return null;
      }

      // Offline / backend hiccup: fall back to the cached profile so the
      // account display survives reboots without network.
      const cached = await db
        .get<string, UserDetails>(levelKeys.user, { valueEncoding: "json" })
        .catch(() => null);
      if (cached && this.isLoggedIn()) return cached;

      logger.warn("Failed to get logged user", error);
      return null;
    }
  }

  static async refreshToken() {
    const response = await this.getInstance()
      .post<{ accessToken: string; expiresIn: number }>("/auth/refresh", {
        refreshToken: this.userAuth.refreshToken,
      })
      .then((response) => response.data);

    const { accessToken, expiresIn } = response;

    const tokenExpirationTimestamp =
      Date.now() + expiresIn * 1000 - this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth.accessToken = accessToken;
    this.userAuth.tokenExpirationTimestamp = tokenExpirationTimestamp;

    logger.log(
      "Token refreshed. New expiration:",
      this.userAuth.tokenExpirationTimestamp
    );

    await db.put<string, Auth>(
      levelKeys.auth,
      {
        ...this.userAuth,
        tokenExpirationTimestamp,
      },
      { valueEncoding: "json" }
    );

    return { accessToken, expiresIn };
  }

  private static async revalidateAccessTokenIfExpired() {
    if (this.userAuth.tokenExpirationTimestamp < Date.now()) {
      try {
        await this.refreshToken();
      } catch (err) {
        await this.handleUnauthorizedError(err);
      }
    }
  }

  private static getAxiosConfig() {
    return {
      headers: {
        Authorization: `Bearer ${this.userAuth.accessToken}`,
      },
    };
  }

  private static readonly handleUnauthorizedError = async (err: unknown) => {
    if (err instanceof AxiosError && err.response?.status === 401) {
      logger.error("401 — dropping the current session");

      this.userAuth = {
        accessToken: "",
        refreshToken: "",
        tokenExpirationTimestamp: 0,
      };

      await db
        .batch([
          { type: "del", key: levelKeys.auth },
          { type: "del", key: levelKeys.user },
        ])
        .catch(() => {});

      WindowManager.sendToAppWindows("on-signout");
    }

    throw err;
  };

  private static async validateOptions(options?: HydraApiOptions) {
    const needsAuth = options?.needsAuth === true;
    if (!needsAuth) return;

    if (!this.isLoggedIn()) {
      throw new Error("User not logged in");
    }

    await this.revalidateAccessTokenIfExpired();
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    const headers = {
      ...this.getAxiosConfig().headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.getInstance()
      .get<T>(url, {
        params,
        headers,
        ...(options?.validateStatus
          ? { validateStatus: options.validateStatus }
          : {}),
        signal: options?.signal,
        logResponseBody: options?.logResponseBody,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    const headers = {
      ...this.getAxiosConfig().headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.getInstance()
      .get<T>(url, {
        params,
        headers,
        ...(options?.validateStatus
          ? { validateStatus: options.validateStatus }
          : {}),
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
        headers: response.headers,
      }))
      .catch(this.handleUnauthorizedError);
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.getInstance()
      .post<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async postResponse<T = unknown>(
    url: string,
    data?: unknown,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.getInstance()
      .post<T>(url, data, {
        ...this.getAxiosConfig(),
        ...(options?.validateStatus
          ? { validateStatus: options.validateStatus }
          : {}),
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
      }))
      .catch(this.handleUnauthorizedError);
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.getInstance()
      .put<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.getInstance()
      .patch<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    await this.validateOptions(options);

    return this.getInstance()
      .delete<T>(url, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async checkDownloadSourcesChanges(
    downloadSourceIds: string[],
    games: Array<{ shop: string; objectId: string }>,
    since: string
  ) {
    logger.info("HydraApi.checkDownloadSourcesChanges called with:", {
      downloadSourceIds,
      gamesCount: games.length,
      since,
    });

    try {
      const result = await this.post<
        Array<{
          shop: string;
          objectId: string;
          newDownloadOptionsCount: number;
          downloadSourceIds: string[];
        }>
      >("/download-sources/changes", {
        downloadSourceIds,
        games,
        since,
      });

      logger.info(
        "HydraApi.checkDownloadSourcesChanges completed successfully:",
        result
      );
      return result;
    } catch (error) {
      logger.error("HydraApi.checkDownloadSourcesChanges failed:", error);
      throw error;
    }
  }
}
