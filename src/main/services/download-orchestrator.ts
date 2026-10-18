import { downloadsSublevel, levelKeys } from "@main/level";
import { withDownloadActivation } from "./download/download-activation";
import { DownloadManager } from "./download/download-manager";
import { WindowManager } from "./window-manager";
import { logger } from "./logger";
import {
  DEFAULT_DOWNLOAD_LAYOUT_STATE,
  getDownloadQueueView,
  getDownloadId,
  isActiveLikeDownload,
  isCompletedLikeDownload,
  type Download,
  type DownloadLayoutState,
  type GameShop,
} from "../../types";
import {
  getNextQueuedDownloadFromLayout,
  getNormalizedDownloadLayoutState,
  getPausedDownloadsOrderedByLayout,
  getQueuedDownloadsOrderedByLayout,
  removeDownloadFromLayoutState,
  saveDownloadLayoutState,
  setDownloadLayoutQueues,
  syncDownloadLayoutState,
} from "./download-layout-state";

export type ResumeDownloadStrategy = "interruptActive" | "queueIfActive";
type ResumeIntent = ResumeDownloadStrategy | "queue";

function getGameKey(download: Pick<Download, "shop" | "objectId">) {
  return levelKeys.game(download.shop, download.objectId);
}

function asQueuedDownload(download: Download) {
  return {
    ...download,
    status: "paused" as const,
    queued: true,
    pinnedToHero: false,
    extracting: false,
    extractionProgress: 0,
  };
}

function asPausedDownload(
  download: Download,
  status: "paused" | "error" = "paused"
) {
  return {
    ...download,
    status,
    queued: false,
    pinnedToHero: false,
    extracting: false,
    extractionProgress: 0,
  };
}

function withInsertedId(ids: string[], id: string, targetIndex?: number) {
  const nextIds = ids.filter((entryId) => entryId !== id);
  const resolvedTargetIndex = Math.max(
    0,
    Math.min(targetIndex ?? nextIds.length, nextIds.length)
  );

  nextIds.splice(resolvedTargetIndex, 0, id);

  return nextIds;
}

const NO_INTERNET_GRACE_MS = 15000;
const RECONNECT_DEBOUNCE_MS = 2000;

export class DownloadOrchestrator {
  private static readonly backgroundStartVersions = new Map<string, number>();
  private static isShuttingDown = false;
  private static readonly preparationControllers = new Map<
    string,
    AbortController
  >();

  private static invalidateBackgroundStart(downloadKey: string) {
    this.preparationControllers.get(downloadKey)?.abort();
    this.preparationControllers.delete(downloadKey);
    this.backgroundStartVersions.set(
      downloadKey,
      (this.backgroundStartVersions.get(downloadKey) ?? 0) + 1
    );
  }

  private static beginPreparation(downloadKey: string) {
    if (this.isShuttingDown) {
      const error = new Error("Downloads are stopping for shutdown");
      error.name = "AbortError";
      throw error;
    }
    this.invalidateBackgroundStart(downloadKey);
    const version = this.backgroundStartVersions.get(downloadKey);
    const controller = new AbortController();
    this.preparationControllers.set(downloadKey, controller);
    return {
      signal: controller.signal,
      controller,
      isCurrent: () =>
        !controller.signal.aborted &&
        this.backgroundStartVersions.get(downloadKey) === version,
      hasCurrentVersion: () =>
        this.backgroundStartVersions.get(downloadKey) === version,
      dispose: () => {
        if (this.preparationControllers.get(downloadKey) === controller) {
          this.preparationControllers.delete(downloadKey);
        }
      },
    };
  }

  static cancelPendingPreparations() {
    this.isShuttingDown = true;
    for (const key of this.preparationControllers.keys()) {
      this.invalidateBackgroundStart(key);
    }
    this.clearReconnectGrace();
  }
  private static isOnline = true;
  private static reconnectGraceTimer: NodeJS.Timeout | null = null;
  private static lastReconnectAt = 0;

  static onNetworkStatusChanged(payload: {
    online: boolean;
    switched?: boolean;
  }) {
    const { online } = payload;

    if (!DownloadManager.isJsDownloadActive) {
      this.isOnline = online;
      this.clearReconnectGrace();
      return;
    }

    if (!online) {
      if (this.isOnline) {
        logger.log(
          "[DownloadOrchestrator] Connection lost during download; waiting for it to come back"
        );
      }
      this.isOnline = false;
      DownloadManager.notifyReconnecting(true);

      if (!this.reconnectGraceTimer) {
        this.reconnectGraceTimer = setTimeout(() => {
          this.reconnectGraceTimer = null;
          if (this.isOnline) return;

          if (!DownloadManager.isActiveDownloadReconnecting()) {
            this.isOnline = true;
            return;
          }

          void this.stopActiveDownloadForNoNetwork();
        }, NO_INTERNET_GRACE_MS);
      }
      return;
    }

    this.isOnline = true;
    this.clearReconnectGrace();

    const now = Date.now();
    if (now - this.lastReconnectAt < RECONNECT_DEBOUNCE_MS) return;
    this.lastReconnectAt = now;

    logger.log(
      "[DownloadOrchestrator] Connection available; resuming the active download"
    );
    DownloadManager.reconnectActiveDownload();
  }

  private static clearReconnectGrace() {
    if (this.reconnectGraceTimer) {
      clearTimeout(this.reconnectGraceTimer);
      this.reconnectGraceTimer = null;
    }
  }

  private static async stopActiveDownloadForNoNetwork() {
    const downloadId = DownloadManager.getActiveDownloadId();
    if (!downloadId) return;

    const download = await downloadsSublevel.get(downloadId).catch(() => null);
    if (!download) return;

    logger.log(
      "[DownloadOrchestrator] No connection after the grace window; pausing the download"
    );
    await this.pauseDownload(download, {
      reason: "paused",
      startNextQueued: false,
    });
  }

  private static async getAllDownloads() {
    return downloadsSublevel.values().all();
  }

  private static async getDownload(shop: GameShop, objectId: string) {
    return downloadsSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
  }

  private static async activateDownload(
    download: Download,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal
  ): Promise<Download | null> {
    if (!signal) {
      const preparation = this.beginPreparation(getGameKey(download));
      try {
        return await this.activateDownload(
          download,
          () => isCurrent() && preparation.isCurrent(),
          preparation.signal
        );
      } finally {
        preparation.dispose();
      }
    }
    if (!isCurrent()) return null;
    const downloadId = getDownloadId(download);
    // A repeated manual action must retain the downloader already owning this slot.
    if (DownloadManager.hasRunningDownload(getGameKey(download))) {
      return download;
    }
    const activeDownload: Download = {
      ...download,
      status: "active",
      queued: false,
      pinnedToHero: false,
      extracting: false,
      extractionProgress: 0,
      timestamp: Date.now(),
    };

    await downloadsSublevel.put(getGameKey(download), activeDownload);
    if (!isCurrent()) return null;

    const prepare = async (): Promise<Download | null> => {
      try {
        await DownloadManager.resumeDownload(activeDownload, signal);
      } catch (error) {
        if (!isCurrent()) return null;
        await downloadsSublevel.put(getGameKey(download), {
          ...activeDownload,
          status: "error",
          queued: false,
        });

        const downloads = await this.getAllDownloads();
        const layoutState = await getNormalizedDownloadLayoutState(downloads);
        await setDownloadLayoutQueues(
          downloads,
          layoutState.queueOrder.filter((id) => id !== downloadId),
          [
            downloadId,
            ...layoutState.pausedOrder.filter((id) => id !== downloadId),
          ]
        );

        WindowManager.sendDownloadsUpdated();

        // The active slot is free again: keep the queue moving instead of
        // stalling on the download that failed to prepare (e.g. expired link),
        // the same way the cancellation path does.
        try {
          const remainingDownloads = await this.getAllDownloads();
          await this.startNextQueuedDownload(
            remainingDownloads.filter(
              (entry) => getDownloadId(entry) !== downloadId
            )
          );
        } catch (queueError) {
          logger.error(
            "[DownloadOrchestrator] Failed to start the next queued download after an activation failure",
            queueError
          );
        }

        throw error;
      }
      return activeDownload;
    };
    return prepare();
  }

  private static async restoreInterruptedDownload(download: Download | null) {
    if (!download) return;

    try {
      const restored = await this.activateDownload(download);
      if (restored) {
        const downloads = await this.getAllDownloads();
        await removeDownloadFromLayoutState(download, downloads);
        WindowManager.sendDownloadsUpdated();
      }
    } catch (error) {
      logger.error(
        "[DownloadOrchestrator] Could not restore the interrupted download",
        error
      );
    }
  }

  private static async setDownloadPausedState(
    download: Download,
    options: {
      queued?: boolean;
      status?: "paused" | "error";
    } = {}
  ) {
    const nextDownload = options.queued
      ? asQueuedDownload(download)
      : asPausedDownload(download, options.status);

    await downloadsSublevel.put(getGameKey(download), nextDownload);

    return nextDownload;
  }

  private static async getDownloadsWithLayout() {
    const downloads = await this.getAllDownloads();
    // Read-only: normalizing + persisting on every read meant a LevelDB
    // write on every Downloads-page render and status broadcast. Mutators
    // (pause/resume/cancel) persist the layout themselves.
    const layoutState = await getNormalizedDownloadLayoutState(downloads);

    return { downloads, layoutState };
  }

  private static startNextQueuedDownload(downloads?: Download[]) {
    return withDownloadActivation(() =>
      this.activateNextQueuedDownload(downloads)
    );
  }

  private static hasActiveTransfer(downloads: Download[]) {
    // Extraction runs independently and does not reserve the transfer slot.
    return (
      DownloadManager.hasActiveDownload() ||
      downloads.some((download) => download.status === "active")
    );
  }

  private static async activateNextQueuedDownload(
    downloads?: Download[],
    prepared?: { id: string; isCurrent: () => boolean; signal: AbortSignal }
  ) {
    if (prepared && !prepared.isCurrent()) return null;
    const currentDownloads = downloads ?? (await this.getAllDownloads());
    if (this.hasActiveTransfer(currentDownloads)) return null;
    const layoutState =
      await getNormalizedDownloadLayoutState(currentDownloads);
    if (DownloadManager.hasActiveDownload()) return null;
    const nextDownload = getNextQueuedDownloadFromLayout(
      currentDownloads,
      layoutState
    );
    if (!nextDownload) {
      WindowManager.sendDownloadsUpdated();
      return null;
    }
    const nextPreparation =
      prepared?.id === getDownloadId(nextDownload) ? prepared : undefined;
    const activated = await this.activateDownload(
      nextDownload,
      nextPreparation?.isCurrent,
      nextPreparation?.signal
    );
    if (activated) {
      WindowManager.sendDownloadsUpdated();
      return nextDownload;
    }
    return this.activateNextQueuedDownload(
      await this.getAllDownloads(),
      prepared
    );
  }

  private static async queueDownload(
    download: Download,
    options: {
      toFront?: boolean;
      targetIndex?: number;
    } = {}
  ) {
    const nextDownload = await this.setDownloadPausedState(download, {
      queued: true,
    });
    const downloads = await this.getAllDownloads();
    const layoutState = await getNormalizedDownloadLayoutState(downloads);
    const nextQueueOrder = withInsertedId(
      layoutState.queueOrder,
      getDownloadId(download),
      options.toFront ? 0 : options.targetIndex
    );

    await setDownloadLayoutQueues(
      downloads,
      nextQueueOrder,
      layoutState.pausedOrder.filter((id) => id !== getDownloadId(download))
    );

    DownloadManager.clearQueueVerifyAttempt(download);

    return nextDownload;
  }

  private static async pauseDownload(
    download: Download,
    options: {
      reason?: "paused" | "error";
      queueActiveReplacement?: boolean;
      startNextQueued?: boolean;
    } = {}
  ) {
    this.invalidateBackgroundStart(getGameKey(download));
    const shouldPauseRuntime = isActiveLikeDownload(download);

    if (shouldPauseRuntime) {
      await DownloadManager.pauseDownload(getGameKey(download));
      WindowManager.sendToAppWindows("on-download-progress", null);
    }

    const savedDownload = shouldPauseRuntime
      ? ((await this.getDownload(download.shop, download.objectId)) ?? download)
      : download;
    const nextDownload = await this.setDownloadPausedState(savedDownload, {
      queued: options.queueActiveReplacement,
      status: options.reason === "error" ? "error" : "paused",
    });

    if (options.queueActiveReplacement) {
      await this.queueDownload(nextDownload, { toFront: true });
    } else {
      const downloads = await this.getAllDownloads();
      const layoutState = await getNormalizedDownloadLayoutState(downloads);
      const nextPausedOrder = withInsertedId(
        layoutState.pausedOrder,
        getDownloadId(download),
        0
      );

      await setDownloadLayoutQueues(
        downloads,
        layoutState.queueOrder.filter((id) => id !== getDownloadId(download)),
        nextPausedOrder
      );
    }

    if (options.startNextQueued && !DownloadManager.hasActiveDownload()) {
      const downloads = await this.getAllDownloads();
      if (!this.hasActiveTransfer(downloads)) {
        await this.startNextQueuedDownload(
          downloads.filter(
            (entry) => getDownloadId(entry) !== getDownloadId(nextDownload)
          )
        );
      }
    }

    WindowManager.sendDownloadsUpdated();

    return nextDownload;
  }

  private static isTerminalDownload(download: Download) {
    return ["removed", "complete", "seeding", "error"].includes(
      download.status ?? ""
    );
  }

  private static normalizeStartupDownload(
    download: Download,
    queueInterrupted: boolean
  ): Download {
    const nextDownload = { ...download };
    if (nextDownload.extracting) nextDownload.extracting = false;
    if (nextDownload.pinnedToHero) nextDownload.pinnedToHero = false;
    if (nextDownload.status === "active") {
      nextDownload.status = "paused";
      nextDownload.queued = queueInterrupted;
    }
    if (this.isTerminalDownload(nextDownload) && nextDownload.queued)
      nextDownload.queued = false;
    return nextDownload;
  }

  static async bootstrapDownloadsOnStartup() {
    const downloads = await this.getAllDownloads();
    let interruptedDownloadId: string | null = null;

    const changedDownloads = downloads
      .map((download) => {
        const nextDownload = this.normalizeStartupDownload(
          download,
          interruptedDownloadId == null
        );
        if (download.status === "active")
          interruptedDownloadId ??= getDownloadId(nextDownload);
        return { download, nextDownload };
      })
      .filter(({ download, nextDownload }) =>
        Object.keys(nextDownload).some(
          (key) => download[key] !== nextDownload[key]
        )
      );
    await Promise.all(
      changedDownloads.map(({ nextDownload }) =>
        downloadsSublevel.put(getGameKey(nextDownload), nextDownload)
      )
    );

    const normalizedDownloads = await this.getAllDownloads();
    await syncDownloadLayoutState(normalizedDownloads);

    if (interruptedDownloadId) {
      return (
        normalizedDownloads.find(
          (download) => getDownloadId(download) === interruptedDownloadId
        ) ?? null
      );
    }

    const layoutState =
      await getNormalizedDownloadLayoutState(normalizedDownloads);
    return getNextQueuedDownloadFromLayout(normalizedDownloads, layoutState);
  }

  static async getLayoutState() {
    const downloads = await this.getAllDownloads();
    return getNormalizedDownloadLayoutState(downloads);
  }

  static async startPreparedDownload(
    download: Download,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal
  ): Promise<{ ok: boolean }> {
    if (!signal) {
      const preparation = this.beginPreparation(getGameKey(download));
      try {
        return await this.startPreparedDownload(
          download,
          () => isCurrent() && preparation.isCurrent(),
          preparation.signal
        );
      } finally {
        preparation.dispose();
      }
    }
    return withDownloadActivation(async () => {
      if (!isCurrent()) return { ok: true };
      const current = await this.getDownload(download.shop, download.objectId);
      if (!isCurrent()) return { ok: true };
      if (
        current &&
        (isActiveLikeDownload(current) || this.isTerminalDownload(current))
      ) {
        return { ok: true };
      }
      await this.queueDownload(download);
      if (!isCurrent()) return { ok: true };
      // Read the slot after preparation and queue persistence. Completion can
      // happen during either wait, including after its empty-queue check.
      await this.activateNextQueuedDownload(undefined, {
        id: getDownloadId(download),
        isCurrent,
        signal,
      });
      WindowManager.sendDownloadsUpdated();
      return { ok: true };
    });
  }

  static async enqueuePreparedDownload(download: Download) {
    await this.queueDownload(download);
    WindowManager.sendDownloadsUpdated();

    return { ok: true };
  }

  static async resumeDownload(
    shop: GameShop,
    objectId: string,
    strategy: ResumeIntent = "interruptActive",
    targetIndex?: number
  ) {
    const preparation = this.beginPreparation(levelKeys.game(shop, objectId));
    try {
      return await this.resumeDownloadWithPreparation(
        shop,
        objectId,
        strategy,
        preparation.isCurrent,
        preparation.signal,
        targetIndex
      );
    } finally {
      preparation.dispose();
    }
  }

  private static async resumeDownloadWithPreparation(
    shop: GameShop,
    objectId: string,
    strategy: ResumeIntent,
    isCurrent: () => boolean,
    signal: AbortSignal,
    targetIndex?: number
  ) {
    const download = await this.getDownload(shop, objectId);

    if (
      !download ||
      !["paused", "active", "error"].includes(download.status ?? "") ||
      download.progress === 1
    ) {
      return false;
    }

    if (!isCurrent()) return false;

    return withDownloadActivation(() =>
      this.activateResumedDownload(
        download,
        strategy,
        isCurrent,
        signal,
        targetIndex
      )
    );
  }

  private static async activateResumedDownload(
    readyDownload: Download,
    strategy: ResumeIntent,
    isCurrent: () => boolean,
    signal: AbortSignal,
    targetIndex?: number
  ) {
    if (!isCurrent()) return false;
    const downloads = await this.getAllDownloads();
    if (!isCurrent()) return false;
    const currentActiveDownload =
      downloads.find(
        (entry) =>
          isActiveLikeDownload(entry) &&
          getDownloadId(entry) !== getDownloadId(readyDownload)
      ) ?? null;

    if (
      strategy === "queue" ||
      (currentActiveDownload && strategy === "queueIfActive")
    ) {
      await this.queueDownload(readyDownload, {
        toFront: strategy !== "queue",
        targetIndex: strategy === "queue" ? targetIndex : undefined,
      });
      if (strategy === "queue") {
        await this.activateNextQueuedDownload(undefined, {
          id: getDownloadId(readyDownload),
          isCurrent,
          signal,
        });
      }
      WindowManager.sendDownloadsUpdated();
      return true;
    }

    if (currentActiveDownload) {
      await this.pauseDownload(currentActiveDownload, {
        reason: "paused",
        startNextQueued: false,
      });
    }

    const activated = await this.activateDownload(
      readyDownload,
      isCurrent,
      signal
    );
    if (!activated) {
      if (!isCurrent()) return false;
      await this.restoreInterruptedDownload(currentActiveDownload);
      return false;
    }
    const nextDownloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(readyDownload, nextDownloads);
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async pauseDownloadById(shop: GameShop, objectId: string) {
    const key = levelKeys.game(shop, objectId);
    this.invalidateBackgroundStart(key);
    const download = await this.getDownload(shop, objectId);
    if (!download) return false;

    await this.pauseDownload(download, {
      reason: "paused",
      startNextQueued: true,
    });

    return true;
  }

  static async cancelDownloadById(shop: GameShop, objectId: string) {
    this.invalidateBackgroundStart(levelKeys.game(shop, objectId));
    const download = await this.getDownload(shop, objectId);
    if (!download) return false;

    const downloadId = getDownloadId(download);
    const wasActive = isActiveLikeDownload(download);

    await DownloadManager.cancelDownload(getGameKey(download));
    WindowManager.sendToAppWindows("on-download-progress", null);

    await downloadsSublevel.put(getGameKey(download), {
      ...download,
      status: "removed",
      queued: false,
      pinnedToHero: false,
      shouldSeed: false,
      extracting: false,
    });

    const downloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(
      { shop: download.shop, objectId: download.objectId },
      downloads.filter((entry) => getDownloadId(entry) !== downloadId)
    );

    if (wasActive) {
      await this.startNextQueuedDownload(
        downloads.filter((entry) => getDownloadId(entry) !== downloadId)
      );
      return true;
    }

    WindowManager.sendDownloadsUpdated();
    return true;
  }

  private static preparePausedPlacement(download: Download) {
    this.invalidateBackgroundStart(getGameKey(download));
    return true;
  }

  static async moveDownloadPlacement(
    shop: GameShop,
    objectId: string,
    targetArea: "hero" | "queue" | "paused",
    targetIndex?: number
  ) {
    const move = () =>
      this.applyDownloadPlacement(shop, objectId, targetArea, targetIndex);
    return targetArea === "hero" ? withDownloadActivation(move) : move();
  }

  private static async applyDownloadPlacement(
    shop: GameShop,
    objectId: string,
    targetArea: "hero" | "queue" | "paused",
    targetIndex?: number
  ) {
    const download = await this.getDownload(shop, objectId);

    if (
      !download ||
      isCompletedLikeDownload(download) ||
      download.status === "removed"
    ) {
      return false;
    }

    if (targetArea === "paused" && !this.preparePausedPlacement(download))
      return false;

    const { downloads, layoutState } = await this.getDownloadsWithLayout();
    const currentActiveDownload =
      downloads.find(
        (entry) =>
          isActiveLikeDownload(entry) &&
          getDownloadId(entry) !== getDownloadId(download)
      ) ?? null;
    const view = getDownloadQueueView(downloads, layoutState);
    const downloadId = getDownloadId(download);
    const isHero = view.heroId === downloadId;
    const queueIds = view.queueIds.filter((id) => id !== downloadId);
    const pausedIds = view.pausedIds.filter((id) => id !== downloadId);

    if (targetArea === "hero") {
      if (currentActiveDownload) {
        await this.pauseDownload(currentActiveDownload, {
          reason: "paused",
          queueActiveReplacement: true,
          startNextQueued: false,
        });
      }

      const activated = await this.activateDownload(download);
      if (!activated) {
        await this.restoreInterruptedDownload(currentActiveDownload);
        return false;
      }
      const nextDownloads = await this.getAllDownloads();
      await setDownloadLayoutQueues(nextDownloads, queueIds, pausedIds);
      WindowManager.sendDownloadsUpdated();
      return true;
    }

    if (targetArea === "queue") {
      return this.moveDownloadToQueue(
        download,
        isHero,
        queueIds,
        pausedIds,
        targetIndex
      );
    }

    if (isHero && isActiveLikeDownload(download)) {
      await this.pauseDownload(download, {
        reason: "paused",
        startNextQueued: true,
      });
    } else {
      await this.setDownloadPausedState(download, { queued: false });
    }

    const nextDownloads = await this.getAllDownloads();
    await setDownloadLayoutQueues(
      nextDownloads,
      queueIds,
      withInsertedId(pausedIds, downloadId, targetIndex)
    );
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  private static async moveDownloadToQueue(
    download: Download,
    isHero: boolean,
    queueIds: string[],
    pausedIds: string[],
    targetIndex?: number
  ): Promise<boolean> {
    const downloadId = getDownloadId(download);
    if (isHero && isActiveLikeDownload(download)) {
      await DownloadManager.pauseDownload(getGameKey(download));
      WindowManager.sendToAppWindows("on-download-progress", null);
    }
    await this.setDownloadPausedState(download, { queued: true });

    const nextDownloads = await this.getAllDownloads();
    await setDownloadLayoutQueues(
      nextDownloads,
      withInsertedId(queueIds, downloadId, targetIndex),
      pausedIds
    );

    DownloadManager.clearQueueVerifyAttempt(download);

    if (isHero) {
      await this.startNextQueuedDownload(
        nextDownloads.filter((entry) => getDownloadId(entry) !== downloadId)
      );
    } else {
      WindowManager.sendDownloadsUpdated();
    }

    return true;
  }

  static async setQueuePosition(
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) {
    const { downloads, layoutState } = await this.getDownloadsWithLayout();
    const queueDownloads = getQueuedDownloadsOrderedByLayout(
      downloads,
      layoutState
    );
    const downloadId = levelKeys.game(shop, objectId);

    if (
      !queueDownloads.some((download) => getDownloadId(download) === downloadId)
    ) {
      return false;
    }

    await setDownloadLayoutQueues(
      downloads,
      withInsertedId(layoutState.queueOrder, downloadId, targetIndex),
      layoutState.pausedOrder
    );
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async setPausedPosition(
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) {
    const { downloads, layoutState } = await this.getDownloadsWithLayout();
    const pausedDownloads = getPausedDownloadsOrderedByLayout(
      downloads,
      layoutState
    );
    const downloadId = levelKeys.game(shop, objectId);

    if (
      !pausedDownloads.some(
        (download) => getDownloadId(download) === downloadId
      )
    ) {
      return false;
    }

    await setDownloadLayoutQueues(
      downloads,
      layoutState.queueOrder,
      withInsertedId(layoutState.pausedOrder, downloadId, targetIndex)
    );
    WindowManager.sendDownloadsUpdated();

    return true;
  }

  static async handleDownloadFailure(downloadId: string) {
    const download = await downloadsSublevel.get(downloadId).catch(() => null);
    if (!download) return;

    try {
      await this.pauseDownload(download, {
        reason: "error",
        startNextQueued: true,
      });
    } catch (error) {
      logger.error(
        "[DownloadOrchestrator] Failed to handle download failure",
        error
      );
    }
  }

  static async syncAfterDownloadRemoved(
    download: Pick<Download, "shop" | "objectId">
  ) {
    const downloads = await this.getAllDownloads();
    await removeDownloadFromLayoutState(download, downloads);
  }

  static async rebuildLayoutState(
    defaultState: DownloadLayoutState = DEFAULT_DOWNLOAD_LAYOUT_STATE
  ) {
    const downloads = await this.getAllDownloads();
    await saveDownloadLayoutState(defaultState);
    return syncDownloadLayoutState(downloads);
  }
}
