import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  PersonIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useGoogleDriveCloud, useToast } from "@renderer/hooks";
import { reportGoogleDriveConnectError } from "@renderer/helpers/google-drive-connect";
import "./settings-context-cloud.scss";

/**
 * Hydra Plus is Drive-only: snapshots live in the user's own Google Drive.
 * There is no provider choice anymore — this panel just manages the Drive
 * account link.
 */
export function SettingsContextCloud() {
  const { t } = useTranslation("settings");
  const { status, connect, disconnect } = useGoogleDriveCloud();
  const { showSuccessToast, showErrorToast } = useToast();

  const [isConnecting, setIsConnecting] = useState(false);

  const isDriveLinked = Boolean(status?.linked);
  const isDriveAvailable = !status?.requiresClientSetup;

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

      <div className="settings-context-panel__group">
        <p className="settings-context-cloud__hint">
          <PersonIcon className="settings-context-cloud__hint-icon" />{" "}
          {t("cloud_privacy_note")}
        </p>
      </div>
    </div>
  );
}
