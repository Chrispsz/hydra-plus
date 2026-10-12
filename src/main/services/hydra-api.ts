import axios, { AxiosError, AxiosInstance } from "axios";
import { networkLogger as logger } from "./logger";
import { appVersion } from "@main/constants";
import {
  sanitizeNetworkLogPayload,
  summarizeNetworkLogPayload,
} from "./network-log-payload";

declare module "axios" {
  interface AxiosRequestConfig {
    logResponseBody?: boolean;
  }
}

export interface HydraApiOptions {
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  logResponseBody?: boolean;
}

/**
 * Anonymous Hydra API client. Hydra Plus has no user accounts: only public
 * catalogue/download-source endpoints are consumed, so no auth/refresh
 * handling is needed here anymore.
 */
export class HydraApi {
  private static instance: AxiosInstance;

  private static readonly ADD_LOG_INTERCEPTOR = true;

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
  }

  private static getInstance() {
    if (!this.instance) {
      throw new Error("HydraApi.setupApi() must run before making requests");
    }
    return this.instance;
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    const headers = {
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
      .then((response) => response.data);
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    const headers = {
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
      }));
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    return this.getInstance()
      .post<T>(url, data, {
        signal: options?.signal,
      })
      .then((response) => response.data);
  }

  static async postResponse<T = unknown>(
    url: string,
    data?: unknown,
    options?: HydraApiOptions
  ) {
    return this.getInstance()
      .post<T>(url, data, {
        ...(options?.validateStatus
          ? { validateStatus: options.validateStatus }
          : {}),
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
      }));
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    return this.getInstance()
      .put<T>(url, data, {
        signal: options?.signal,
      })
      .then((response) => response.data);
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    return this.getInstance()
      .patch<T>(url, data, {
        signal: options?.signal,
      })
      .then((response) => response.data);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    return this.getInstance()
      .delete<T>(url, {
        signal: options?.signal,
      })
      .then((response) => response.data);
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
