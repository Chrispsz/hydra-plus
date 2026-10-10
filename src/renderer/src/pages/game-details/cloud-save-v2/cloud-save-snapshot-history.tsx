import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { GameShop, SnapshotVersionSummary } from "@types";
import { formatBytes } from "@shared";
import { Button, ConfirmationModal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";

export interface CloudSaveSnapshotHistoryProps {
  visible: boolean;
  objectId: string;
  shop: GameShop;
  onRestored?: () => void | Promise<void>;
}

/**
 * Google Drive snapshot history for one game. Every upload leaves a
 * version behind; the user can restore, download (export to a local
 * folder) or delete any version without touching the current files.
 */
export function CloudSaveSnapshotHistory({
  visible,
  objectId,
  shop,
  onRestored,
}: Readonly<CloudSaveSnapshotHistoryProps>) {
  const { t } = useTranslation("game_details");
  const { formatDate } = useDate();
  const { showSuccessToast, showErrorToast } = useToast();

  const [versions, setVersions] = useState<SnapshotVersionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [deletingVersion, setDeletingVersion] = useState<number | null>(null);

  const refreshVersions = useCallback(async () => {
    if (!visible) return;
    setIsLoading(true);
    try {
      const list = await window.electron.getGameSnapshotVersions(
        objectId,
        shop
      );
      setVersions([...list].reverse());
    } catch {
      setVersions([]);
    } finally {
      setIsLoading(false);
    }
  }, [objectId, shop, visible]);

  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    if (!visible) return;
    const unsubscribe = window.electron.onSnapshotVersionDownloadProgress(
      () => undefined
    );
    return unsubscribe;
  }, [visible]);

  const handleRestore = async (version: number) => {
    setBusyVersion(version);
    try {
      await window.electron.restoreGameSnapshotVersion(
        globalThis.crypto.randomUUID(),
        objectId,
        shop,
        version
      );
      showSuccessToast(t("cloud_save_history_restore_success", { version }));
      await onRestored?.();
    } catch (error) {
      showErrorToast(
        t("cloud_save_history_restore_error_title"),
        t("cloud_save_history_restore_error_description")
      );
      throw error;
    } finally {
      setBusyVersion(null);
      setRestoringVersion(null);
    }
  };

  const handleDownload = async (version: number) => {
    setBusyVersion(version);
    try {
      const result = await window.electron.downloadGameSnapshotVersion(
        objectId,
        shop,
        version
      );
      if (result) {
        showSuccessToast(t("cloud_save_history_download_success", { version }));
      }
    } catch {
      showErrorToast(
        t("cloud_save_history_download_error_title"),
        t("cloud_save_history_download_error_description")
      );
    } finally {
      setBusyVersion(null);
    }
  };

  const handleDelete = async (version: number) => {
    setBusyVersion(version);
    try {
      await window.electron.deleteGameSnapshotVersion(objectId, shop, version);
      showSuccessToast(t("cloud_save_history_delete_success", { version }));
      await refreshVersions();
    } catch {
      showErrorToast(
        t("cloud_save_history_delete_error_title"),
        t("cloud_save_history_delete_error_description")
      );
    } finally {
      setBusyVersion(null);
      setDeletingVersion(null);
    }
  };

  if (!visible) return null;

  return (
    <section className="cloud-save-v2__snapshot-history">
      <div className="cloud-save-v2__snapshot-history-header">
        <h3>{t("cloud_save_history_title")}</h3>
        <Button theme="outline" onClick={() => void refreshVersions()}>
          <ArrowClockwiseIcon />
          {t("cloud_save_history_refresh")}
        </Button>
      </div>

      <p className="cloud-save-v2__snapshot-history-description">
        {t("cloud_save_history_description")}
      </p>

      {isLoading && versions.length === 0 ? (
        <div className="cloud-save-v2__snapshot-history-loading">
          <CircleNotchIcon className="animate-spin" />
        </div>
      ) : versions.length === 0 ? (
        <p className="cloud-save-v2__snapshot-history-empty">
          {t("cloud_save_history_empty")}
        </p>
      ) : (
        <ul className="cloud-save-v2__snapshot-history-list">
          {versions.map((version) => {
            const isBusy = busyVersion === version.version;
            return (
              <li
                key={`${version.version}-${version.id}`}
                className="cloud-save-v2__snapshot-history-row"
              >
                <div className="cloud-save-v2__snapshot-history-info">
                  <span className="cloud-save-v2__snapshot-history-version">
                    {t("cloud_save_history_version_label", {
                      version: version.version,
                    })}
                    {version.current
                      ? ` · ${t("cloud_save_history_current")}`
                      : ""}
                  </span>
                  <span className="cloud-save-v2__snapshot-history-meta">
                    {formatDate(version.savedAt)} ·{" "}
                    {t("cloud_save_history_files", {
                      count: version.fileCount,
                    })}{" "}
                    · {formatBytes(version.totalSizeBytes)}
                  </span>
                </div>

                <div className="cloud-save-v2__snapshot-history-actions">
                  {isBusy ? (
                    <CircleNotchIcon className="animate-spin" />
                  ) : (
                    <>
                      <Button
                        theme="outline"
                        onClick={() => setRestoringVersion(version.version)}
                        title={t("cloud_save_history_restore")}
                      >
                        <ArrowClockwiseIcon />
                        {t("cloud_save_history_restore")}
                      </Button>
                      <Button
                        theme="outline"
                        onClick={() => void handleDownload(version.version)}
                        title={t("cloud_save_history_download")}
                      >
                        <DownloadSimpleIcon />
                        {t("cloud_save_history_download")}
                      </Button>
                      {!version.current && (
                        <Button
                          theme="danger"
                          onClick={() => setDeletingVersion(version.version)}
                          title={t("cloud_save_history_delete")}
                        >
                          <TrashIcon />
                          {t("cloud_save_history_delete")}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmationModal
        visible={restoringVersion !== null}
        title={t("cloud_save_history_confirm_restore_title")}
        descriptionText={t("cloud_save_history_confirm_restore_description", {
          version: restoringVersion ?? 0,
        })}
        confirmButtonLabel={t("cloud_save_history_restore")}
        cancelButtonLabel={t("cancel")}
        onConfirm={() => {
          if (restoringVersion !== null) {
            void handleRestore(restoringVersion).catch(() => undefined);
          }
        }}
        onClose={() => setRestoringVersion(null)}
      />

      <ConfirmationModal
        visible={deletingVersion !== null}
        title={t("cloud_save_history_confirm_delete_title")}
        descriptionText={t("cloud_save_history_confirm_delete_description", {
          version: deletingVersion ?? 0,
        })}
        confirmButtonLabel={t("cloud_save_history_delete")}
        cancelButtonLabel={t("cancel")}
        onConfirm={() => {
          if (deletingVersion !== null) {
            void handleDelete(deletingVersion);
          }
        }}
        onClose={() => setDeletingVersion(null)}
      />
    </section>
  );
}
