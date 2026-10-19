import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  DeviceDesktopIcon,
  FileDirectoryIcon,
  FileIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { useLibrary, useToast } from "@renderer/hooks";
import {
  buildGameDetailsPath,
  getGameTitleFromExecutablePath,
  resolveImageSource,
} from "@renderer/helpers";
import { LINUX_GAME_EXECUTABLE_EXTENSIONS } from "@shared";
import type { ExternalGameCandidate } from "@types";

import "./sidebar-adding-custom-game-modal.scss";

export interface SidebarAddingCustomGameModalProps {
  visible: boolean;
  onClose: () => void;
}

const SOURCE_BADGE_KEYS: Record<ExternalGameCandidate["source"], string> = {
  hytale: "custom_game_modal_source_hytale",
  linux_desktop_entry: "custom_game_modal_source_linux_app",
  windows_registry: "custom_game_modal_source_windows_app",
};

const RENDERABLE_ICON_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
];

/** Only real image files can be shown (and stored) as an icon. */
const isRenderableIconPath = (iconPath: string | null): boolean => {
  if (!iconPath) return false;

  const extension = iconPath.slice(iconPath.lastIndexOf(".") + 1).toLowerCase();

  return RENDERABLE_ICON_EXTENSIONS.includes(extension);
};

export function SidebarAddingCustomGameModal({
  visible,
  onClose,
}: Readonly<SidebarAddingCustomGameModalProps>) {
  const { t } = useTranslation("sidebar");
  const { updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();
  const navigate = useNavigate();

  const [gameName, setGameName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  const [candidates, setCandidates] = useState<ExternalGameCandidate[] | null>(
    null
  );
  const [selectedCandidate, setSelectedCandidate] =
    useState<ExternalGameCandidate | null>(null);
  const [failedIconIds, setFailedIconIds] = useState<string[]>([]);

  const [savePaths, setSavePaths] = useState<string[]>([]);
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(true);

  const resetForm = () => {
    setGameName("");
    setExecutablePath("");
    setSelectedCandidate(null);
    setSavePaths([]);
    setIsAutoSyncEnabled(true);
  };

  const handleGameNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(event.target.value);
  };

  const handleScanSystem = async () => {
    if (isScanning) return;

    setIsScanning(true);
    setScanFailed(false);

    try {
      const results = await window.electron.scanExternalGames();
      setCandidates(results);
      setFailedIconIds([]);
    } catch (error) {
      console.error("Failed to scan external games:", error);
      setCandidates(null);
      setScanFailed(true);
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelectCandidate = (candidate: ExternalGameCandidate) => {
    setSelectedCandidate(candidate);
    setGameName(candidate.title);
    setExecutablePath(candidate.executablePath ?? "");
    setSavePaths((previousPaths) => {
      const nextPaths = [...previousPaths];
      for (const savePath of candidate.savePaths) {
        if (!nextPaths.includes(savePath)) nextPaths.push(savePath);
      }
      return nextPaths;
    });
  };

  const handleCandidateIconError = (candidateId: string) => {
    setFailedIconIds((previous) =>
      previous.includes(candidateId) ? previous : [...previous, candidateId]
    );
  };

  const handleSelectExecutable = async () => {
    const filters =
      window.electron.platform === "linux"
        ? [
            {
              name: t("custom_game_modal_executable"),
              extensions: LINUX_GAME_EXECUTABLE_EXTENSIONS,
            },
            { name: t("all_files", { ns: "game_details" }), extensions: ["*"] },
          ]
        : [
            {
              name: t("custom_game_modal_executable"),
              extensions: [
                "exe",
                "msi",
                "bat",
                "cmd",
                "app",
                "deb",
                "rpm",
                "dmg",
              ],
            },
          ];

    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters,
    });

    if (filePaths && filePaths.length > 0) {
      const selectedPath = filePaths[0];
      const previousTitle = executablePath
        ? getGameTitleFromExecutablePath(executablePath)
        : "";

      // Browsing a different executable detaches the scan candidate: its
      // source/platform labels would no longer describe this import. The
      // save-path matrix stays untouched — those rows are visible and the
      // user owns them.
      if (
        selectedCandidate &&
        selectedPath !== selectedCandidate.executablePath
      ) {
        setSelectedCandidate(null);
      }

      setExecutablePath(selectedPath);

      if (!gameName.trim() || gameName === previousTitle) {
        setGameName(getGameTitleFromExecutablePath(selectedPath));
      }
    }
  };

  const appendSavePath = (savePath: string) => {
    setSavePaths((previousPaths) =>
      previousPaths.includes(savePath)
        ? previousPaths
        : [...previousPaths, savePath]
    );
  };

  const handleAddSaveFolder = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });

    if (canceled || !filePaths || filePaths.length === 0) return;

    appendSavePath(filePaths[0]);
  };

  const handleAddSaveFile = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
    });

    if (canceled || !filePaths || filePaths.length === 0) return;

    appendSavePath(filePaths[0]);
  };

  const handleRemoveSavePath = (savePath: string) => {
    setSavePaths((previousPaths) =>
      previousPaths.filter((item) => item !== savePath)
    );
  };

  const handleAddGame = async () => {
    if (!gameName.trim() || !executablePath.trim()) {
      showErrorToast(t("custom_game_modal_fill_required"));
      return;
    }

    setIsAdding(true);

    try {
      const candidateIconUrl =
        selectedCandidate?.iconPath &&
        isRenderableIconPath(selectedCandidate.iconPath)
          ? selectedCandidate.iconPath
          : "";

      const newGame = await window.electron.addCustomGameToLibrary(
        gameName.trim(),
        executablePath,
        candidateIconUrl,
        "",
        "",
        savePaths.length > 0 ? savePaths : undefined,
        selectedCandidate?.platform,
        selectedCandidate?.source ?? "manual"
      );

      if (savePaths.length > 0 && isAutoSyncEnabled) {
        try {
          await window.electron.setCloudSaveAutomaticSyncEnabled(
            newGame.objectId,
            "custom",
            true
          );
        } catch (error) {
          // The game was created; only the preference failed (e.g. Google
          // Drive not linked). Keep the success flow and surface a warning.
          console.error("Failed to enable automatic cloud sync:", error);
          showWarningToast(t("custom_game_modal_auto_sync_failed"));
        }
      }

      showSuccessToast(t("custom_game_modal_success"));
      updateLibrary();

      const gameDetailsPath = buildGameDetailsPath({
        shop: "custom",
        objectId: newGame.objectId,
        title: newGame.title,
      });

      navigate(gameDetailsPath);

      resetForm();
      onClose();
    } catch (error) {
      console.error("Failed to add custom game:", error);
      showErrorToast(
        error instanceof Error ? error.message : t("custom_game_modal_failed")
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    if (!isAdding) {
      resetForm();
      onClose();
    }
  };

  const isFormValid = gameName.trim() && executablePath.trim();
  const hasCandidates = Boolean(candidates && candidates.length > 0);

  return (
    <Modal
      visible={visible}
      title={t("custom_game_modal")}
      description={t("custom_game_modal_description")}
      onClose={handleClose}
    >
      <div className="sidebar-adding-custom-game-modal__container">
        <section
          className="sidebar-adding-custom-game-modal__detect-section"
          aria-busy={isScanning}
        >
          <div className="sidebar-adding-custom-game-modal__detect-header">
            <div className="sidebar-adding-custom-game-modal__detect-heading">
              <h4 className="sidebar-adding-custom-game-modal__detect-title">
                {t("custom_game_modal_detect_title")}
              </h4>
              <p className="sidebar-adding-custom-game-modal__detect-hint">
                {t("custom_game_modal_detect_hint")}
              </p>
            </div>
            <Button
              type="button"
              theme="outline"
              onClick={handleScanSystem}
              disabled={isScanning}
            >
              <SyncIcon
                size={14}
                className={cn({
                  "sidebar-adding-custom-game-modal__scan-spinner": isScanning,
                })}
              />
              {isScanning
                ? t("custom_game_modal_scanning")
                : t("custom_game_modal_scan_system")}
            </Button>
          </div>

          {scanFailed && !isScanning && (
            <div className="sidebar-adding-custom-game-modal__scan-error">
              <span>{t("custom_game_modal_scan_failed")}</span>
              <Button type="button" theme="outline" onClick={handleScanSystem}>
                {t("custom_game_modal_scan_retry")}
              </Button>
            </div>
          )}

          {!scanFailed &&
            candidates &&
            candidates.length === 0 &&
            !isScanning && (
              <p className="sidebar-adding-custom-game-modal__scan-empty">
                {t("custom_game_modal_scan_no_results")}
              </p>
            )}

          {hasCandidates && !isScanning && (
            <>
              <p className="sidebar-adding-custom-game-modal__scan-count">
                {t("custom_game_modal_scan_results", {
                  count: candidates?.length,
                })}
              </p>
              <ul className="sidebar-adding-custom-game-modal__candidates-list">
                {candidates?.map((candidate) => {
                  const isSelected = selectedCandidate?.id === candidate.id;

                  return (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className={cn(
                          "sidebar-adding-custom-game-modal__candidate",
                          {
                            "sidebar-adding-custom-game-modal__candidate--selected":
                              isSelected,
                          }
                        )}
                        onClick={() => handleSelectCandidate(candidate)}
                        aria-pressed={isSelected}
                        disabled={isAdding}
                      >
                        {isRenderableIconPath(candidate.iconPath) &&
                        !failedIconIds.includes(candidate.id) ? (
                          <img
                            src={resolveImageSource(candidate.iconPath)}
                            alt=""
                            className="sidebar-adding-custom-game-modal__candidate-icon"
                            onError={() =>
                              handleCandidateIconError(candidate.id)
                            }
                          />
                        ) : (
                          <span className="sidebar-adding-custom-game-modal__candidate-icon sidebar-adding-custom-game-modal__candidate-icon--empty">
                            <DeviceDesktopIcon size={16} />
                          </span>
                        )}

                        <span className="sidebar-adding-custom-game-modal__candidate-info">
                          <span className="sidebar-adding-custom-game-modal__candidate-title">
                            {candidate.title}
                          </span>
                          <span
                            className="sidebar-adding-custom-game-modal__candidate-path"
                            title={candidate.executablePath ?? undefined}
                          >
                            {candidate.executablePath ?? "—"}
                          </span>
                        </span>

                        {candidate.savePaths.length > 0 && (
                          <span className="sidebar-adding-custom-game-modal__candidate-chip sidebar-adding-custom-game-modal__candidate-chip--saves">
                            {t("custom_game_modal_saves_detected")}
                          </span>
                        )}
                        <span className="sidebar-adding-custom-game-modal__candidate-chip">
                          {t(SOURCE_BADGE_KEYS[candidate.source])}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <div className="sidebar-adding-custom-game-modal__form">
          <TextField
            label={t("custom_game_modal_executable_path")}
            placeholder={t("custom_game_modal_select_executable")}
            value={executablePath}
            readOnly
            theme="dark"
            rightContent={
              <Button
                type="button"
                theme="outline"
                onClick={handleSelectExecutable}
                disabled={isAdding}
              >
                <FileDirectoryIcon />
                {t("custom_game_modal_browse")}
              </Button>
            }
          />

          <TextField
            label={t("custom_game_modal_title")}
            placeholder={t("custom_game_modal_enter_title")}
            value={gameName}
            onChange={handleGameNameChange}
            theme="dark"
            disabled={isAdding}
          />
        </div>

        <section className="sidebar-adding-custom-game-modal__cloud-saves-section">
          <div className="sidebar-adding-custom-game-modal__cloud-saves-header">
            <h4 className="sidebar-adding-custom-game-modal__cloud-saves-title">
              {t("custom_game_modal_cloud_saves_title")}
            </h4>
            <div className="sidebar-adding-custom-game-modal__cloud-saves-actions">
              <Button
                type="button"
                theme="outline"
                onClick={handleAddSaveFolder}
                disabled={isAdding}
              >
                <FileDirectoryIcon size={14} />
                {t("custom_game_modal_add_save_folder")}
              </Button>
              <Button
                type="button"
                theme="outline"
                onClick={handleAddSaveFile}
                disabled={isAdding}
              >
                <FileIcon size={14} />
                {t("custom_game_modal_add_save_file")}
              </Button>
            </div>
          </div>

          <p className="sidebar-adding-custom-game-modal__cloud-saves-hint">
            {t("custom_game_modal_cloud_saves_hint")}
          </p>

          {savePaths.length > 0 && (
            <ul className="sidebar-adding-custom-game-modal__save-paths-list">
              {savePaths.map((savePath) => (
                <li
                  key={savePath}
                  className="sidebar-adding-custom-game-modal__save-path-item"
                >
                  <span
                    className="sidebar-adding-custom-game-modal__save-path-text"
                    title={savePath}
                  >
                    {savePath}
                  </span>
                  <button
                    type="button"
                    className="sidebar-adding-custom-game-modal__save-path-remove"
                    onClick={() => handleRemoveSavePath(savePath)}
                    aria-label={t("custom_game_modal_remove_save_path")}
                    disabled={isAdding}
                  >
                    <XIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {savePaths.length > 0 && (
            <div className="sidebar-adding-custom-game-modal__auto-sync">
              <CheckboxField
                label={t("custom_game_modal_auto_sync_label")}
                checked={isAutoSyncEnabled}
                onChange={() => setIsAutoSyncEnabled((previous) => !previous)}
                disabled={isAdding}
              />
              <p className="sidebar-adding-custom-game-modal__auto-sync-hint">
                {t("custom_game_modal_auto_sync_hint")}
              </p>
            </div>
          )}
        </section>

        <div className="sidebar-adding-custom-game-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={handleClose}
            disabled={isAdding}
          >
            {t("custom_game_modal_cancel")}
          </Button>
          <Button
            type="button"
            theme="primary"
            onClick={handleAddGame}
            disabled={!isFormValid || isAdding}
          >
            {isAdding
              ? t("custom_game_modal_adding")
              : t("custom_game_modal_add")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
