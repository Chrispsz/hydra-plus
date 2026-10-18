import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { DownloadOrchestrator } from "./download-orchestrator";
import { gamesPlaytime, watchProcesses } from "./process-watcher";
import { UpdateManager } from "./update-manager";
import { runPeriodicCloudSaveSync } from "./cloud-save/periodic-sync";
import { INTERVALS } from "@main/constants";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import { logger } from "./logger";

const wrapInLoop = (fn: () => unknown, interval: number) => {
  const loop = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await fn();
      } catch (error) {
        logger.error(
          `Error in loop: ${error instanceof Error ? error.stack : String(error)}`
        );
      }

      await sleep(interval);
    }
  };
  loop();
};

export const startMainLoop = async () => {
  wrapInLoop(() => watchProcesses(), INTERVALS.processWatcher);
  wrapInLoop(() => DownloadManager.watchDownloads(), INTERVALS.downloadWatcher);
  wrapInLoop(
    () => DownloadOrchestrator.pollAwaitingDebridDownloads(),
    INTERVALS.debridReadinessWatcher
  );
  wrapInLoop(
    () => DownloadManager.getSeedStatus(),
    INTERVALS.seedStatusWatcher
  );
  wrapInLoop(() => UpdateManager.checkForUpdates(), INTERVALS.updateChecker);
  wrapInLoop(() => runPeriodicCloudSaveSync(), INTERVALS.cloudSavePeriodicSync);

  wrapInLoop(() => {
    PowerSaveBlockerManager.syncState({
      downloadActive: DownloadManager.hasActiveDownload(),
      compatibilityGameActive:
        PowerSaveBlockerManager.hasRunningCompatibilityGame(
          gamesPlaytime.keys()
        ),
    });
  }, INTERVALS.powerSaveBlockerSync);
};
