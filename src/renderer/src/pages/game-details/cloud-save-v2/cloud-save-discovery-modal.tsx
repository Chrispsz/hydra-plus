import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowsCounterClockwiseIcon,
  CircleNotchIcon,
  MagnifyingGlassIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";

import type { DiscoveredSaveLocation, GameShop } from "@types";
import { formatBytes } from "@shared";
import { Button, Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";

export interface CloudSaveDiscoveryModalProps {
  visible: boolean;
  objectId: string;
  shop: GameShop;
  onClose: () => void;
  onLocationRegistered: () => void | Promise<void>;
}

const ENV_LABEL_KEYS: Record<DiscoveredSaveLocation["environment"], string> = {
  "wine-prefix": "cloud_save_discovery_env_wine",
  "steam-proton": "cloud_save_discovery_env_proton",
  "steam-cloud-userdata": "cloud_save_discovery_env_steam_cloud",
  native: "cloud_save_discovery_env_native",
  documents: "cloud_save_discovery_env_documents",
  home: "cloud_save_discovery_env_home",
  "install-dir": "cloud_save_discovery_env_install_dir",
};

/**
 * System-wide save discovery: scans Wine/Proton prefixes, native paths,
 * Steam Cloud userdata and the install dir for folders that look like
 * this game's saves. The user picks which ones the cloud should track.
 */
export function CloudSaveDiscoveryModal({
  visible,
  objectId,
  shop,
  onClose,
  onLocationRegistered,
}: Readonly<CloudSaveDiscoveryModalProps>) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();

  const [locations, setLocations] = useState<DiscoveredSaveLocation[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [registeringPath, setRegisteringPath] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setLocations([]);
    try {
      const found = await window.electron.discoverGameSaveLocations(
        objectId,
        shop
      );
      setLocations(found);
    } catch {
      setLocations([]);
    } finally {
      setIsScanning(false);
    }
  }, [objectId, shop]);

  useEffect(() => {
    if (visible) void runScan();
  }, [runScan, visible]);

  const handleTrack = async (location: DiscoveredSaveLocation) => {
    setRegisteringPath(location.absolutePath);
    try {
      await window.electron.registerDiscoveredSaveLocation(
        objectId,
        shop,
        location.absolutePath
      );
      showSuccessToast(t("cloud_save_discovery_tracked_success"));
      await onLocationRegistered?.();
      await runScan();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("mapped-location-overlap")) {
        showSuccessToast(t("cloud_save_discovery_already_covered"));
      } else {
        showErrorToast(
          t("cloud_save_discovery_track_error_title"),
          t("cloud_save_discovery_track_error_description")
        );
      }
      await runScan();
    } finally {
      setRegisteringPath(null);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("cloud_save_discovery_title")}
      description={t("cloud_save_discovery_description")}
      onClose={onClose}
      large
    >
      <div className="cloud-save-v2__discovery">
        <div className="cloud-save-v2__discovery-toolbar">
          <Button theme="outline" onClick={() => void runScan()}>
            {isScanning ? (
              <CircleNotchIcon className="animate-spin" />
            ) : (
              <ArrowsCounterClockwiseIcon />
            )}
            {t("cloud_save_discovery_scan_again")}
          </Button>
          <span className="cloud-save-v2__discovery-count">
            {t("cloud_save_discovery_count", { count: locations.length })}
          </span>
        </div>

        {isScanning && locations.length === 0 ? (
          <div className="cloud-save-v2__discovery-loading">
            <CircleNotchIcon className="animate-spin" />
            <span>{t("cloud_save_discovery_scanning")}</span>
          </div>
        ) : locations.length === 0 ? (
          <div className="cloud-save-v2__discovery-empty">
            <MagnifyingGlassIcon />
            <span>{t("cloud_save_discovery_empty")}</span>
          </div>
        ) : (
          <ul className="cloud-save-v2__discovery-list">
            {locations.map((location) => {
              const isRegistering = registeringPath === location.absolutePath;
              return (
                <li
                  key={location.absolutePath}
                  className="cloud-save-v2__discovery-row"
                >
                  <div className="cloud-save-v2__discovery-info">
                    <span className="cloud-save-v2__discovery-path">
                      {location.absolutePath}
                    </span>
                    <span className="cloud-save-v2__discovery-meta">
                      {t(ENV_LABEL_KEYS[location.environment])} ·{" "}
                      {t("cloud_save_discovery_files", {
                        count: location.fileCount,
                      })}{" "}
                      · {formatBytes(location.totalSizeBytes)}
                    </span>
                  </div>

                  <div className="cloud-save-v2__discovery-actions">
                    {location.tracked ? (
                      <span className="cloud-save-v2__discovery-tracked">
                        <SealCheckIcon />
                        {t("cloud_save_discovery_tracked")}
                      </span>
                    ) : isRegistering ? (
                      <CircleNotchIcon className="animate-spin" />
                    ) : (
                      <Button
                        theme="primary"
                        onClick={() => void handleTrack(location)}
                      >
                        {t("cloud_save_discovery_track")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
