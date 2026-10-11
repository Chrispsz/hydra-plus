import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { SyncIcon } from "@primer/octicons-react";
import { Link } from "../link/link";
import "./auto-update-header.scss";
import type { AppUpdaterEvent, PortableReleaseInfo } from "@types";
import { formatBytes } from "@shared";

export const releasesPageUrl =
  "https://github.com/Chrispsz/hydra-plus/releases/latest";

type PortableUpdatePhase =
  | "idle"
  | "downloading"
  | "downloaded"
  | "installing"
  | "failed";

/**
 * Update banner. Hydra Plus self-updates in place:
 * - Linux AppImage: electron-updater replaces the file at its path
 *   (settings/shortcuts untouched).
 * - Windows portable: the new exe is downloaded in-app and swapped over
 *   the running one at the same path (old exe removed, shortcuts intact).
 * - Everything else: deep link to this fork's releases page.
 */
export function AutoUpdateSubHeader() {
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [isAutoInstallAvailable, setIsAutoInstallAvailable] = useState(false);

  const [portableRelease, setPortableRelease] =
    useState<PortableReleaseInfo | null>(null);
  const [portablePhase, setPortablePhase] =
    useState<PortableUpdatePhase>("idle");
  const [portableProgress, setPortableProgress] = useState(0);

  const { t } = useTranslation("header");

  const handleClickInstallUpdate = () => {
    window.electron.restartAndInstallUpdate();
  };

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvent) => {
        if (event.type == "update-available") {
          setNewVersion(event.info.version);
        }

        if (event.type == "update-downloaded") {
          setIsReadyToInstall(true);
        }
      }
    );

    window.electron.checkForUpdates().then(async (isAutoInstallAvailable) => {
      setIsAutoInstallAvailable(isAutoInstallAvailable);

      // Windows portable: electron-updater cannot self-install — use the
      // built-in portable updater instead of sending the user to a browser.
      if (!isAutoInstallAvailable && window.electron.platform === "win32") {
        const release = await window.electron.fetchLatestPortableRelease();
        if (release) {
          const state = await window.electron.getPortableUpdateState();
          setPortableRelease(release);
          setNewVersion((current) => current ?? release.version);
          if (state.downloaded) setPortablePhase("downloaded");
        }
      }
    });

    const unsubscribePortableProgress =
      window.electron.onPortableUpdateProgress((percent) => {
        setPortablePhase("downloading");
        setPortableProgress(percent);
      });

    return () => {
      unsubscribe();
      unsubscribePortableProgress();
    };
  }, []);

  if (!newVersion) return null;

  const version = portableRelease?.version ?? newVersion;

  if (portableRelease && !isAutoInstallAvailable) {
    const sizeLabel = portableRelease.sizeBytes
      ? ` · ${formatBytes(portableRelease.sizeBytes)}`
      : "";

    return (
      <header className="auto-update-sub-header">
        {portablePhase === "downloaded" || portablePhase === "installing" ? (
          <button
            type="button"
            className="auto-update-sub-header__new-version-button"
            disabled={portablePhase === "installing"}
            onClick={async () => {
              setPortablePhase("installing");
              await window.electron.applyPortableUpdate();
            }}
          >
            <SyncIcon
              className="auto-update-sub-header__new-version-icon"
              size={12}
            />
            {portablePhase === "installing"
              ? t("version_installing")
              : t("version_available_install", { version })}
          </button>
        ) : (
          <button
            type="button"
            className="auto-update-sub-header__new-version-button"
            disabled={portablePhase === "downloading"}
            onClick={() => {
              setPortablePhase("downloading");
              window.electron
                .downloadPortableUpdate()
                .then(() => setPortablePhase("downloaded"))
                .catch(() => setPortablePhase("failed"));
            }}
          >
            <SyncIcon
              className="auto-update-sub-header__new-version-icon"
              size={12}
            />
            {portablePhase === "downloading"
              ? t("version_downloading_progress", {
                  version,
                  progress: portableProgress,
                })
              : portablePhase === "failed"
                ? t("version_download_failed")
                : t("version_available_download", { version })}
            {portablePhase !== "failed" ? sizeLabel : ""}
          </button>
        )}
      </header>
    );
  }

  if (!isAutoInstallAvailable) {
    return (
      <header className="auto-update-sub-header">
        <Link
          to={releasesPageUrl}
          className="auto-update-sub-header__new-version-link"
        >
          <SyncIcon
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_download", { version })}
        </Link>
      </header>
    );
  }

  if (isReadyToInstall) {
    return (
      <header className="auto-update-sub-header">
        <button
          type="button"
          className="auto-update-sub-header__new-version-button"
          onClick={handleClickInstallUpdate}
        >
          <SyncIcon
            className="auto-update-sub-header__new-version-icon"
            size={12}
          />
          {t("version_available_install", { version })}
        </button>
      </header>
    );
  }

  return null;
}
