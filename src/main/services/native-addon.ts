import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { app } from "electron";
import type { ProcessPayload } from "./download/types";
import type {
  BuildLocalGameSnapshotInput,
  BuildLocalGameSnapshotPipelineInput,
  BuildSnapshotAggregateHashInput,
  DeleteLocalSaveTarget,
  DeleteLocalSaveTargetsResult,
  GameSaveRules,
  GetSaveRulesForGameInput,
  NativeLocalGameSnapshotPipelineResult,
  ReplaceRestoreTarget,
  ReplaceRestoreTargetsResult,
  ResolveRestoreTargetsInput,
  ResolveRestoreTargetsResult,
  ShouldSkipRestoreFileInput,
  VerifyDownloadedRestoreFileResult,
  CheckCloudSaveCustomPathOverlapInput,
  CheckCloudSaveCustomPathOverlapResult,
} from "@types";

import { logger } from "./logger";

type NativeProcessProfileImageResponse = {
  imagePath?: string;
  image_path?: string;
  mimeType?: string;
  mime_type?: string;
};

type NativeProcessSizedImageResponse = NativeProcessProfileImageResponse & {
  isAnimated?: boolean;
  is_animated?: boolean;
};

type NativeActiveWindowResponse = {
  windowId?: string;
  window_id?: string;
  processId?: number;
  process_id?: number;
};

type HydraNativeModule = {
  torrentInitialize: (port: number) => Promise<void>;
  torrentRequest: (method: string, paramsJson: string) => Promise<string>;
  torrentShutdown: () => Promise<void>;
  processProfileImage: (
    imagePath: string,
    targetExtension?: string
  ) => NativeProcessProfileImageResponse;
  processImage: (
    imagePath: string,
    outputPathBase: string,
    width: number,
    height: number,
    preserveAnimation: boolean
  ) => Promise<NativeProcessSizedImageResponse>;
  listProcesses: () => ProcessPayload[];
  getLinuxActiveWindow: () => NativeActiveWindowResponse | null;
  buildLocalGameSnapshotPipeline: (
    input: BuildLocalGameSnapshotPipelineInput
  ) => Promise<NativeLocalGameSnapshotPipelineResult>;
  buildLocalGameSnapshot: (
    input: BuildLocalGameSnapshotInput
  ) => Promise<NativeLocalGameSnapshotPipelineResult>;
  getSaveRulesForGame: (
    input: GetSaveRulesForGameInput
  ) => Promise<GameSaveRules>;
  buildSnapshotAggregateHash: (
    input: BuildSnapshotAggregateHashInput
  ) => string;
  checkCloudSaveCustomPathOverlap: (
    input: CheckCloudSaveCustomPathOverlapInput
  ) => CheckCloudSaveCustomPathOverlapResult;
  uploadLocalSaveBlob: (
    absolutePath: string,
    uploadUrl: string,
    contentLength: string,
    checksumSha256: string
  ) => Promise<void>;
  resolveRestoreTargets: (
    input: ResolveRestoreTargetsInput
  ) => Promise<ResolveRestoreTargetsResult>;
  downloadRestoreBlobToTemp: (
    snapshotId: string,
    hash: string,
    expectedSizeBytes: number,
    downloadUrl: string,
    tempRoot: string
  ) => Promise<string>;
  verifyDownloadedRestoreFile: (
    tempPath: string,
    expectedHash: string
  ) => Promise<VerifyDownloadedRestoreFileResult>;
  shouldSkipRestoreFile: (
    localPath: string,
    expectedHash: string
  ) => Promise<boolean>;
  replaceRestoreTargets: (
    files: ReplaceRestoreTarget[]
  ) => Promise<ReplaceRestoreTargetsResult>;
  deleteLocalSaveTargets: (
    files: DeleteLocalSaveTarget[],
    cleanupRootPaths?: string[]
  ) => Promise<DeleteLocalSaveTargetsResult>;
  cleanupRestoreTempSnapshot: (
    snapshotId: string,
    tempRoot: string
  ) => Promise<void>;
};

export type SystemProcessMap = {
  processMap: Record<string, string[]>;
  winePrefixMap: Record<string, string>;
  linuxProcesses: Array<{
    name: string;
    cwd: string;
    exe: string;
    pid: number;
    appImagePath: string | null;
    steamCompatDataPath: string | null;
  }>;
};

// Runs in the worker thread (CJS context).
// "list"  → posts back the raw ProcessPayload array (used by close-game, launch-game)
// "map"   → posts back compact pre-built maps (used by the main loop's watchProcesses)
const WORKER_CODE = `
const { workerData, parentPort } = require('worker_threads');
const path = require('path');
if (process.platform === 'linux' && workerData.addonDir) {
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? workerData.addonDir + ':' + process.env.LD_LIBRARY_PATH
    : workerData.addonDir;
}
const addon = require(workerData.addonPath);
const platform = process.platform;

function buildMaps(processes) {
  const processMap = Object.create(null);
  const winePrefixMap = Object.create(null);
  const linuxProcesses = [];

  for (const proc of processes) {
    const key = proc.name && proc.name.toLowerCase();
    const value = platform === 'win32'
      ? proc.exe
      : path.join(proc.cwd || '', proc.name || '');

    if (!key || !value) continue;

    const steamCompatDataPath = proc.environ && proc.environ.STEAM_COMPAT_DATA_PATH;
    if (steamCompatDataPath) winePrefixMap[value] = steamCompatDataPath;

    if (platform === 'linux') {
      const appImagePath = proc.environ && proc.environ.APPIMAGE;
      linuxProcesses.push({
        name: key,
        cwd: (proc.cwd || '').toLowerCase(),
        exe: (proc.exe || '').toLowerCase(),
        pid: proc.pid,
        appImagePath: appImagePath ? appImagePath.toLowerCase() : null,
        steamCompatDataPath: steamCompatDataPath ? steamCompatDataPath.toLowerCase() : null,
      });
    }

    if (!processMap[key]) processMap[key] = [];
    processMap[key].push(value);
  }

  return { processMap, winePrefixMap, linuxProcesses };
}

parentPort.on('message', (type) => {
  try {
    const processes = addon.listProcesses();
    if (type === 'map') {
      parentPort.postMessage({ type: 'map', result: buildMaps(processes) });
    } else {
      parentPort.postMessage({ type: 'list', result: processes });
    }
  } catch (_) {
    if (type === 'map') {
      parentPort.postMessage({ type: 'map', result: null });
    } else {
      parentPort.postMessage({ type: 'list', result: [] });
    }
  }
});
`;

type PendingResolver =
  | { type: "list"; resolve: (p: ProcessPayload[]) => void }
  | { type: "map"; resolve: (m: SystemProcessMap | null) => void };

interface PendingRequest {
  resolver: PendingResolver;
  /** Guards against a worker that never answers a request. */
  timeout: NodeJS.Timeout;
}

/** A stuck worker must not leave requesters pending forever. */
const WORKER_REQUEST_TIMEOUT_MS = 10_000;

export class NativeAddon {
  public static torrentInitialize(port: number) {
    return this.load().torrentInitialize(port);
  }

  public static torrentRequest(method: string, paramsJson: string) {
    return this.load().torrentRequest(method, paramsJson);
  }

  public static torrentShutdown() {
    // Quitting an app which never used torrenting must not load the addon.
    return this.nativeModule?.torrentShutdown() ?? Promise.resolve();
  }
  private static nativeModule: HydraNativeModule | null = null;
  private static worker: Worker | null = null;
  private static pendingResolvers: PendingRequest[] = [];

  private static resolveAddonPath() {
    if (app.isPackaged) {
      return path.join(
        process.resourcesPath,
        "hydra-native",
        "hydra-native.node"
      );
    }

    return path.join(app.getAppPath(), "hydra-native", "hydra-native.node");
  }

  private static load() {
    if (this.nativeModule) return this.nativeModule;

    const addonPath = this.resolveAddonPath();
    const addonDir = path.dirname(addonPath);

    if (!fs.existsSync(addonPath)) {
      throw new Error(`Hydra native addon not found at ${addonPath}`);
    }

    if (process.platform === "linux") {
      process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
        ? `${addonDir}:${process.env.LD_LIBRARY_PATH}`
        : addonDir;
    }

    const require = createRequire(import.meta.url);
    const nativeModule = require(addonPath) as HydraNativeModule;

    this.nativeModule = nativeModule;

    return nativeModule;
  }

  private static getWorker(): Worker {
    if (this.worker) return this.worker;

    const addonPath = this.resolveAddonPath();
    const addonDir = path.dirname(addonPath);

    if (!fs.existsSync(addonPath)) {
      throw new Error(`Hydra native addon not found at ${addonPath}`);
    }

    this.worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { addonPath, addonDir },
    });

    this.worker.on("message", ({ result }) => {
      const pending = this.pendingResolvers.shift();
      if (!pending) return;
      clearTimeout(pending.timeout);
      if (pending.resolver.type === "list") {
        (pending.resolver.resolve as (p: ProcessPayload[]) => void)(
          (result as ProcessPayload[]).filter(
            (p): p is ProcessPayload =>
              typeof p?.pid === "number" &&
              typeof p?.name === "string" &&
              p.name.length > 0
          )
        );
      } else {
        (pending.resolver.resolve as (m: SystemProcessMap | null) => void)(
          result as SystemProcessMap | null
        );
      }
    });

    this.worker.on("error", (error) => {
      logger.error("Process list worker error", error);
      this.drainResolvers();
    });

    this.worker.on("exit", (code) => {
      if (code !== 0)
        logger.error(`Process list worker exited with code ${code}`);
      this.worker = null;
      this.drainResolvers();
    });

    return this.worker;
  }

  public static processProfileImage(
    imagePath: string,
    targetExtension = "webp"
  ) {
    try {
      const response = this.load().processProfileImage(
        imagePath,
        targetExtension
      );

      const normalizedImagePath = response.imagePath ?? response.image_path;
      const normalizedMimeType = response.mimeType ?? response.mime_type;

      if (!normalizedImagePath || !normalizedMimeType) {
        throw new Error("Hydra native addon returned an invalid payload");
      }

      return {
        imagePath: normalizedImagePath,
        mimeType: normalizedMimeType,
      };
    } catch (error) {
      logger.error("Failed to process profile image via native addon", error);
      throw error;
    }
  }

  public static async processImage(
    imagePath: string,
    outputPathBase: string,
    width: number,
    height: number,
    preserveAnimation: boolean
  ) {
    try {
      const response = await this.load().processImage(
        imagePath,
        outputPathBase,
        width,
        height,
        preserveAnimation
      );

      const normalizedImagePath = response.imagePath ?? response.image_path;
      const normalizedMimeType = response.mimeType ?? response.mime_type;
      const normalizedIsAnimated =
        response.isAnimated ?? response.is_animated ?? false;

      if (!normalizedImagePath || !normalizedMimeType) {
        throw new Error("Hydra native addon returned an invalid payload");
      }

      return {
        imagePath: normalizedImagePath,
        mimeType: normalizedMimeType,
        isAnimated: normalizedIsAnimated,
      };
    } catch (error) {
      logger.error("Failed to process image via native addon", error);
      throw error;
    }
  }

  private static drainResolvers() {
    const drained = this.pendingResolvers.splice(0);
    for (const pending of drained) {
      clearTimeout(pending.timeout);
      if (pending.resolver.type === "list") {
        pending.resolver.resolve([]);
      } else {
        pending.resolver.resolve(null);
      }
    }
  }

  /**
   * Times out a single request: resolves it with the empty payload (the
   * same contract the callers already handle for a failed enumeration)
   * and recycles the worker so later requests get a fresh one.
   */
  private static trackPendingRequest(
    resolver: PendingResolver
  ): PendingRequest {
    const request: PendingRequest = {
      resolver,
      timeout: setTimeout(() => {
        const index = this.pendingResolvers.indexOf(request);
        if (index === -1) return; // answered in the meantime

        this.pendingResolvers.splice(index, 1);
        logger.warn(
          "Process list worker request timed out; recycling the worker"
        );

        if (request.resolver.type === "list") {
          request.resolver.resolve([]);
        } else {
          request.resolver.resolve(null);
        }

        this.recycleWorker();
      }, WORKER_REQUEST_TIMEOUT_MS),
    };

    request.timeout.unref();
    return request;
  }

  /**
   * Discards the current worker: pending requests were posted to it and
   * will never be answered, so they are drained with the empty payload
   * before the next request spawns a replacement worker.
   */
  private static recycleWorker() {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;

    this.drainResolvers();
    // The intentional termination must not be logged as a crash.
    worker.removeAllListeners();
    void worker.terminate().catch(() => {});
  }

  public static listProcesses(): Promise<ProcessPayload[]> {
    return new Promise((resolve) => {
      try {
        const worker = this.getWorker();
        this.pendingResolvers.push(
          this.trackPendingRequest({ type: "list", resolve })
        );
        worker.postMessage("list");
      } catch {
        resolve([]);
      }
    });
  }

  public static getLinuxActiveWindow() {
    if (process.platform !== "linux") return null;

    try {
      const response = this.load().getLinuxActiveWindow();
      if (!response) return null;

      const windowId = response.windowId ?? response.window_id;
      if (!windowId) return null;

      return {
        windowId,
        processId: response.processId ?? response.process_id ?? null,
      };
    } catch (error) {
      logger.error("Failed to identify active Linux window", error);
      return null;
    }
  }

  public static getSystemProcessMap(): Promise<SystemProcessMap | null> {
    return new Promise((resolve) => {
      try {
        const worker = this.getWorker();
        this.pendingResolvers.push(
          this.trackPendingRequest({ type: "map", resolve })
        );
        worker.postMessage("map");
      } catch {
        resolve(null);
      }
    });
  }

  public static buildLocalGameSnapshotPipeline(
    input: BuildLocalGameSnapshotPipelineInput
  ) {
    return this.load().buildLocalGameSnapshotPipeline(input);
  }

  public static buildLocalGameSnapshot(input: BuildLocalGameSnapshotInput) {
    return this.load().buildLocalGameSnapshot(input);
  }

  public static getSaveRulesForGame(input: GetSaveRulesForGameInput) {
    return this.load().getSaveRulesForGame(input);
  }

  public static checkCloudSaveCustomPathOverlap(
    input: CheckCloudSaveCustomPathOverlapInput
  ) {
    return this.load().checkCloudSaveCustomPathOverlap(input);
  }

  public static buildSnapshotAggregateHash(
    input: BuildSnapshotAggregateHashInput
  ) {
    return this.load().buildSnapshotAggregateHash(input);
  }

  public static uploadLocalSaveBlob(
    absolutePath: string,
    uploadUrl: string,
    contentLength: string,
    checksumSha256: string
  ) {
    return this.load().uploadLocalSaveBlob(
      absolutePath,
      uploadUrl,
      contentLength,
      checksumSha256
    );
  }

  public static resolveRestoreTargets(input: ResolveRestoreTargetsInput) {
    return this.load().resolveRestoreTargets(input);
  }

  public static downloadRestoreBlobToTemp(
    snapshotId: string,
    hash: string,
    expectedSizeBytes: number,
    downloadUrl: string,
    tempRoot: string
  ) {
    return this.load().downloadRestoreBlobToTemp(
      snapshotId,
      hash,
      expectedSizeBytes,
      downloadUrl,
      tempRoot
    );
  }

  public static verifyDownloadedRestoreFile(
    tempPath: string,
    expectedHash: string
  ) {
    return this.load().verifyDownloadedRestoreFile(tempPath, expectedHash);
  }

  public static shouldSkipRestoreFile(input: ShouldSkipRestoreFileInput) {
    return this.load().shouldSkipRestoreFile(
      input.localPath,
      input.expectedHash
    );
  }

  public static replaceRestoreTargets(files: ReplaceRestoreTarget[]) {
    return this.load().replaceRestoreTargets(files);
  }

  public static deleteLocalSaveTargets(
    files: DeleteLocalSaveTarget[],
    cleanupRootPaths?: string[]
  ) {
    return this.load().deleteLocalSaveTargets(files, cleanupRootPaths);
  }

  public static cleanupRestoreTempSnapshot(
    snapshotId: string,
    tempRoot: string
  ) {
    return this.load().cleanupRestoreTempSnapshot(snapshotId, tempRoot);
  }
}
