import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  PersonIcon,
  TrashIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, ConfirmationModal } from "@renderer/components";
import { useGoogleDriveCloud, useToast } from "@renderer/hooks";
import { useAppSelector } from "@renderer/hooks";
import { reportGoogleDriveConnectError } from "@renderer/helpers/google-drive-connect";
import { settingsContext } from "@renderer/context";
import { formatBytes } from "@shared";
import type { DriveHygieneOverview } from "@types";
import "./settings-context-cloud.scss";

const DEFAULT_SNAPSHOT_RETENTION = 20;
const DEFAULT_PERIODIC_SYNC_MINUTES = 30;
const MIN_SNAPSHOT_RETENTION = 3;
const MAX_SNAPSHOT_RETENTION = 200;

/**
 * Hydra Plus is Drive-only: snapshots live in the user's own Google Drive.
 * There is no provider choice anymore — this panel manages the Drive
 * account link, snapshot retention and storage hygiene (trash + orphan
 * blob cleanup).
 */
export function SettingsContextCloud() {
  const { t } = useTranslation("settings");
  const { status, connect, disconnect } = useGoogleDriveCloud();
  const { showSuccessToast, showErrorToast } = useToast();
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [isConnecting, setIsConnecting] = useState(false);

  const isDriveLinked = Boolean(status?.linked);
  const isDriveAvailable = !status?.requiresClientSetup;
  const retention =
    userPreferences?.cloudSaveSnapshotRetention ?? DEFAULT_SNAPSHOT_RETENTION;
  const periodicSyncMinutes =
    userPreferences?.cloudSavePeriodicSyncMinutes ??
    DEFAULT_PERIODIC_SYNC_MINUTES;

  const [hygiene, setHygiene] = useState<DriveHygieneOverview | null>(null);
  const [isHygieneLoading, setIsHygieneLoading] = useState(false);
  const [isCleaningTrash, setIsCleaningTrash] = useState(false);
  const [isGcRunning, setIsGcRunning] = useState(false);
  const [pendingCleanup, setPendingCleanup] = useState<
    "trash" | "orphans" | null
  >(null);

  // Local drafts so the number inputs don't clamp/persist on every keystroke
  // (typing "15" used to flash the minimum value mid-typing).
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [periodicSyncDraft, setPeriodicSyncDraft] = useState<string | null>(
    null
  );

  const refreshHygiene = useCallback(async () => {
    if (!isDriveLinked) return;
    setIsHygieneLoading(true);
    try {
      setHygiene(await window.electron.getGoogleDriveHygieneOverview());
    } catch {
      setHygiene(null);
    } finally {
      setIsHygieneLoading(false);
    }
  }, [isDriveLinked]);

  useEffect(() => {
    void refreshHygiene();
  }, [refreshHygiene]);

  const handlePeriodicSyncChange = (value: number) => {
    const next = Math.min(
      360,
      Math.max(
        0,
        Number.isFinite(value) ? value : DEFAULT_PERIODIC_SYNC_MINUTES
      )
    );
    void updateUserPreferences({ cloudSavePeriodicSyncMinutes: next });
  };

  const handleRetentionChange = (value: number) => {
    const next = Math.min(
      MAX_SNAPSHOT_RETENTION,
      Math.max(
        MIN_SNAPSHOT_RETENTION,
        Number.isFinite(value) ? value : DEFAULT_SNAPSHOT_RETENTION
      )
    );
    void updateUserPreferences({ cloudSaveSnapshotRetention: next });
  };

  const commitRetentionDraft = () => {
    if (retentionDraft === null) return;
    setRetentionDraft(null);
    const parsed = Number(retentionDraft);
    if (retentionDraft.trim() === "" || !Number.isFinite(parsed)) return;
    handleRetentionChange(parsed);
  };

  const commitPeriodicSyncDraft = () => {
    if (periodicSyncDraft === null) return;
    setPeriodicSyncDraft(null);
    const parsed = Number(periodicSyncDraft);
    if (periodicSyncDraft.trim() === "" || !Number.isFinite(parsed)) return;
    handlePeriodicSyncChange(parsed);
  };

  const runCleanup = async (kind: "trash" | "orphans") => {
    setPendingCleanup(null);
    if (kind === "trash") setIsCleaningTrash(true);
    else setIsGcRunning(true);
    try {
      const result =
        kind === "trash"
          ? await window.electron.cleanupGoogleDriveTrash()
          : await window.electron.deleteGoogleDriveOrphanBlobs();
      showSuccessToast(
        t("google_drive_cleanup_done", {
          files: result.deletedFiles,
          size: formatBytes(result.freedBytes),
        })
      );
      await refreshHygiene();
    } catch {
      showErrorToast(t("google_drive_cleanup_error"));
    } finally {
      setIsCleaningTrash(false);
      setIsGcRunning(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connect();
      showSuccessToast(t("google_drive_linked"));
    } catch (error) {
      reportGoogleDriveConnectError(error, showErrorToast, t);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      showSuccessToast(t("google_drive_disconnected"));
    } catch {
      showErrorToast(t("google_drive_auth_failed"));
    }
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("google_drive")}</h3>

        <p className="settings-context-cloud__description">
          {t("cloud_provider_description")}
        </p>

        <div className="settings-context-cloud__account">
          <span className="settings-context-cloud__account-email">
            {isDriveLinked ? (
              <CheckCircleFillIcon className="settings-context-cloud__icon-ok" />
            ) : (
              <XCircleFillIcon className="settings-context-cloud__icon-error" />
            )}
            {isDriveLinked
              ? (status?.email ?? t("google_drive_linked"))
              : t("google_drive_not_linked")}
          </span>

          {isDriveLinked ? (
            <Button theme="outline" onClick={handleDisconnect}>
              {t("google_drive_disconnect")}
            </Button>
          ) : (
            <Button
              type="button"
              theme="primary"
              onClick={handleConnect}
              disabled={isConnecting || !isDriveAvailable}
            >
              {isConnecting
                ? t("google_drive_connecting")
                : t("google_drive_connect")}
            </Button>
          )}
        </div>

        {!isDriveLinked && !isDriveAvailable ? (
          <p className="settings-context-cloud__hint">
            {t("google_drive_requires_setup")}
          </p>
        ) : null}

        {isDriveLinked ? (
          <p className="settings-context-cloud__hint">
            {t("google_drive_hint")}
          </p>
        ) : null}
      </div>

      {isDriveLinked ? (
        <div className="settings-context-panel__group">
          <h3>{t("google_drive_hygiene_title")}</h3>

          <div className="settings-context-cloud__hygiene-row">
            <label htmlFor="snapshot-retention">
              {t("google_drive_retention_label")}
            </label>
            <input
              id="snapshot-retention"
              type="number"
              min={MIN_SNAPSHOT_RETENTION}
              max={MAX_SNAPSHOT_RETENTION}
              value={retentionDraft ?? String(retention)}
              onChange={(event) => setRetentionDraft(event.target.value)}
              onBlur={commitRetentionDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          <p className="settings-context-cloud__hint">
            {t("google_drive_retention_hint")}
          </p>

          <div className="settings-context-cloud__hygiene-row">
            <label htmlFor="periodic-sync">
              {t("google_drive_periodic_sync_label")}
            </label>
            <input
              id="periodic-sync"
              type="number"
              min={0}
              max={360}
              value={periodicSyncDraft ?? String(periodicSyncMinutes)}
              onChange={(event) => setPeriodicSyncDraft(event.target.value)}
              onBlur={commitPeriodicSyncDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          <p className="settings-context-cloud__hint">
            {t("google_drive_periodic_sync_hint")}
          </p>

          {isHygieneLoading ? (
            <p className="settings-context-cloud__hint">
              {t("google_drive_hygiene_loading")}
            </p>
          ) : hygiene ? (
            <p className="settings-context-cloud__hint">
              {t("google_drive_hygiene_usage", {
                games: hygiene.gameCount,
                versions: hygiene.versionCount,
                blobs: hygiene.blobCount,
                size: formatBytes(hygiene.blobBytes),
                orphans: hygiene.orphanBlobCount,
                trash: hygiene.trashedFileCount,
              })}
            </p>
          ) : null}

          <div className="settings-context-cloud__hygiene-actions">
            <Button
              type="button"
              theme="outline"
              disabled={
                !hygiene || hygiene.trashedFileCount === 0 || isCleaningTrash
              }
              onClick={() => setPendingCleanup("trash")}
            >
              <TrashIcon />
              {t("google_drive_cleanup_trash", {
                count: hygiene?.trashedFileCount ?? 0,
              })}
            </Button>
            <Button
              type="button"
              theme="outline"
              disabled={
                !hygiene || hygiene.orphanBlobCount === 0 || isGcRunning
              }
              onClick={() => setPendingCleanup("orphans")}
            >
              <TrashIcon />
              {t("google_drive_cleanup_orphans", {
                count: hygiene?.orphanBlobCount ?? 0,
              })}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="settings-context-panel__group">
        <p className="settings-context-cloud__hint">
          <PersonIcon className="settings-context-cloud__hint-icon" />{" "}
          {t("cloud_privacy_note")}
        </p>
      </div>

      <ConfirmationModal
        visible={pendingCleanup !== null}
        title={t("google_drive_cleanup_confirm_title")}
        descriptionText={
          pendingCleanup === "trash"
            ? t("google_drive_cleanup_confirm_trash")
            : t("google_drive_cleanup_confirm_orphans")
        }
        confirmButtonLabel={t("google_drive_cleanup_confirm_button")}
        cancelButtonLabel={t("cancel")}
        onConfirm={() => {
          if (pendingCleanup) void runCleanup(pendingCleanup);
        }}
        onClose={() => setPendingCleanup(null)}
      />
    </div>
  );
}
