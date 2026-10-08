import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useGoogleDriveCloud, useToast } from "@renderer/hooks";
import { reportGoogleDriveConnectError } from "@renderer/helpers/google-drive-connect";

/**
 * Shown in the game options modal cloud sections when the user has not
 * linked their Google Drive yet. Replaces the old Hydra Cloud paywall —
 * in Hydra Plus, Cloud Saves are free through the user's own Drive.
 */
export function DriveCloudConnectCta() {
  const { t } = useTranslation("game_details");
  const { t: tSettings } = useTranslation("settings");
  const { connect, requiresClientSetup } = useGoogleDriveCloud();
  const { showErrorToast, showSuccessToast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connect();
      showSuccessToast(t("google_drive_linked_toast"));
    } catch (error) {
      reportGoogleDriveConnectError(error, showErrorToast, tSettings);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="game-options-modal__cloud-panel game-options-modal__cloud-panel--v2">
      <div className="game-options-modal__panel-header">
        <h2>
          <CloudIcon /> {t("google_drive_connect_required_title")}
        </h2>
        <p>{t("google_drive_connect_required_description")}</p>
      </div>

      {requiresClientSetup ? (
        <p>{tSettings("google_drive_requires_setup")}</p>
      ) : (
        <Button
          type="button"
          theme="primary"
          onClick={handleConnect}
          disabled={isConnecting}
        >
          {isConnecting
            ? tSettings("google_drive_connecting")
            : tSettings("google_drive_connect")}
        </Button>
      )}
    </div>
  );
}
