import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  LinkExternalIcon,
  PersonIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Badge, Button, Link, RadioField } from "@renderer/components";
import { useGoogleDriveCloud, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import "./settings-context-cloud.scss";
import type { CloudStorageProvider } from "@types";

const HYDRA_CLOUD_URL = "https://hydralauncher.gg";

export function SettingsContextCloud() {
  const { t } = useTranslation("settings");
  const { provider, status, connect, disconnect } = useGoogleDriveCloud();
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const [isConnecting, setIsConnecting] = useState(false);

  const isDriveLinked = Boolean(status?.linked);
  const isDriveAvailable = !status?.requiresClientSetup;

  const handleProviderChange = (nextProvider: CloudStorageProvider) => {
    if (nextProvider === provider) return;
    updateUserPreferences({ cloudProvider: nextProvider });
    showSuccessToast(
      nextProvider === "google-drive"
        ? t("google_drive_selected")
        : t("hydra_cloud_selected")
    );
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connect();
      showSuccessToast(t("google_drive_linked"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "google_auth_failed";

      if (message.includes("client_id_missing")) {
        showErrorToast(t("google_drive_client_id_missing"));
      } else if (message.includes("denied")) {
        showErrorToast(t("google_drive_permission_denied"));
      } else if (message.includes("timeout")) {
        showErrorToast(t("google_drive_auth_timeout"));
      } else {
        showErrorToast(t("google_drive_auth_failed"));
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      await updateUserPreferences({ cloudProvider: "hydra" });
      showSuccessToast(t("google_drive_disconnected"));
    } catch {
      showErrorToast(t("google_drive_auth_failed"));
    }
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("cloud_provider")}</h3>

        <p className="settings-context-cloud__description">
          {t("cloud_provider_description")}
        </p>

        <div className="settings-context-cloud__providers">
          <div
            className={`settings-context-cloud__provider ${
              provider === "hydra"
                ? "settings-context-cloud__provider--selected"
                : ""
            }`}
          >
            <div className="settings-context-cloud__provider-row">
              <RadioField
                label={t("provider_hydra")}
                name="cloud-provider"
                checked={provider === "hydra"}
                onChange={() => handleProviderChange("hydra")}
              />
              <Badge>{t("provider_hydra_badge")}</Badge>
            </div>
            <p className="settings-context-cloud__provider-description">
              {t("provider_hydra_description")}
            </p>
          </div>

          <div
            className={`settings-context-cloud__provider ${
              provider === "google-drive"
                ? "settings-context-cloud__provider--selected"
                : ""
            }`}
          >
            <div className="settings-context-cloud__provider-row">
              <RadioField
                label={t("provider_google_drive")}
                name="cloud-provider"
                checked={provider === "google-drive"}
                onChange={() => handleProviderChange("google-drive")}
              />
              <Badge>{t("provider_google_drive_badge")}</Badge>
            </div>
            <p className="settings-context-cloud__provider-description">
              {t("provider_google_drive_description")}
            </p>
          </div>
        </div>
      </div>

      {provider === "google-drive" ? (
        <div className="settings-context-panel__group">
          <h3>{t("google_drive")}</h3>

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
      ) : (
        <div className="settings-context-panel__group">
          <p className="settings-context-cloud__hint">
            {t("hydra_cloud_provider_hint")}{" "}
            <Link to={HYDRA_CLOUD_URL}>
              <LinkExternalIcon />
              hydralauncher.gg
            </Link>
          </p>
        </div>
      )}

      <div className="settings-context-panel__group">
        <p className="settings-context-cloud__hint">
          <PersonIcon className="settings-context-cloud__hint-icon" />{" "}
          {t("cloud_privacy_note")}
        </p>
      </div>
    </div>
  );
}
