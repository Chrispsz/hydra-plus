import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  LinkExternalIcon,
  PersonIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Badge, Button, Link, TextField } from "@renderer/components";
import { useGoogleDriveCloud, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import type { CloudStorageProvider } from "@types";

const GOOGLE_OAUTH_SETUP_URL =
  "https://console.cloud.google.com/apis/credentials";
const GOOGLE_DRIVE_API_URL =
  "https://console.cloud.google.com/apis/library/drive.googleapis.com";

function GoogleDriveSetup() {
  const { t } = useTranslation("settings");
  const { status, connect, disconnect } = useGoogleDriveCloud();
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    setClientId("");
    setClientSecret("");
  }, [status?.linked]);

  const handleSaveClient = async () => {
    if (!clientId.trim()) {
      showErrorToast(t("google_drive_client_id_required"));
      return;
    }

    await updateUserPreferences({
      googleDriveClientId: clientId.trim(),
      googleDriveClientSecret: clientSecret.trim() || undefined,
    });

    showSuccessToast(t("changes_saved"));
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
    <div className="settings-context-panel__group">
      <h3>{t("google_drive")}</h3>

      <div className="settings-cloud__account">
        {status?.linked ? (
          <>
            <span className="settings-cloud__account-email">
              <CheckCircleFillIcon className="settings-cloud__icon-ok" />
              {status.email ?? t("google_drive_linked")}
            </span>
            <Button theme="outline" onClick={handleDisconnect}>
              {t("google_drive_disconnect")}
            </Button>
          </>
        ) : (
          <>
            <span className="settings-cloud__account-email">
              <XCircleFillIcon className="settings-cloud__icon-error" />
              {t("google_drive_not_linked")}
            </span>
            <Button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting || status?.requiresClientSetup}
            >
              {isConnecting
                ? t("google_drive_connecting")
                : t("google_drive_connect")}
            </Button>
          </>
        )}
      </div>

      {status?.requiresClientSetup ? (
        <div className="settings-cloud__setup">
          <p>{t("google_drive_setup_instructions")}</p>
          <ol>
            <li>
              <Link to={GOOGLE_DRIVE_API_URL}>
                <LinkExternalIcon />
                {t("google_drive_enable_api")}
              </Link>
            </li>
            <li>
              <Link to={GOOGLE_OAUTH_SETUP_URL}>
                <LinkExternalIcon />
                {t("google_drive_create_client")}
              </Link>
              <p className="settings-cloud__setup-hint">
                {t("google_drive_client_type_hint")}
              </p>
            </li>
            <li>{t("google_drive_paste_client")}</li>
          </ol>

          <TextField
            label={t("google_drive_client_id")}
            value={clientId}
            placeholder="1234567890-abcdefg.apps.googleusercontent.com"
            onChange={(event) => setClientId(event.target.value)}
          />
          <TextField
            label={t("google_drive_client_secret")}
            value={clientSecret}
            placeholder="GOCSPX-…"
            hint={t("google_drive_client_secret_hint")}
            onChange={(event) => setClientSecret(event.target.value)}
          />
          <Button type="button" theme="outline" onClick={handleSaveClient}>
            {t("google_drive_save_client")}
          </Button>
        </div>
      ) : null}

      {status?.linked ? (
        <p className="settings-cloud__hint">{t("google_drive_hint")}</p>
      ) : null}
    </div>
  );
}

export function SettingsContextCloud() {
  const { t } = useTranslation("settings");
  const { provider } = useGoogleDriveCloud();
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast } = useToast();

  const handleProviderChange = (nextProvider: CloudStorageProvider) => {
    if (nextProvider === provider) return;
    updateUserPreferences({ cloudProvider: nextProvider });
    showSuccessToast(
      nextProvider === "google-drive"
        ? t("google_drive_selected")
        : t("hydra_cloud_selected")
    );
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("cloud_provider")}</h3>
        <p className="settings-cloud__description">
          {t("cloud_provider_description")}
        </p>

        <div className="settings-cloud__providers">
          <button
            type="button"
            className={`settings-cloud__provider-card ${
              provider === "hydra"
                ? "settings-cloud__provider-card--active"
                : ""
            }`}
            onClick={() => handleProviderChange("hydra")}
          >
            <div className="settings-cloud__provider-header">
              <strong>{t("provider_hydra")}</strong>
              <Badge>{t("provider_hydra_badge")}</Badge>
            </div>
            <span>{t("provider_hydra_description")}</span>
          </button>

          <button
            type="button"
            className={`settings-cloud__provider-card ${
              provider === "google-drive"
                ? "settings-cloud__provider-card--active"
                : ""
            }`}
            onClick={() => handleProviderChange("google-drive")}
          >
            <div className="settings-cloud__provider-header">
              <strong>{t("provider_google_drive")}</strong>
              <Badge>{t("provider_google_drive_badge")}</Badge>
            </div>
            <span>{t("provider_google_drive_description")}</span>
          </button>
        </div>
      </div>

      {provider === "google-drive" ? (
        <GoogleDriveSetup />
      ) : (
        <div className="settings-context-panel__group">
          <p className="settings-cloud__hint">
            {t("hydra_cloud_provider_hint")}{" "}
            <Link to="https://hydralauncher.gg">
              <LinkExternalIcon />
              hydralauncher.gg
            </Link>
          </p>
        </div>
      )}

      <div className="settings-context-panel__group">
        <p className="settings-cloud__hint">
          <PersonIcon /> {t("cloud_privacy_note")}
        </p>
      </div>
    </div>
  );
}
