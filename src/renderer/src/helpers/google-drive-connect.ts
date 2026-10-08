import type { TFunction } from "i18next";

type ShowErrorToast = (message: string, title?: string) => void;

/**
 * Maps an error thrown by the Google Drive OAuth flow to an actionable,
 * user-facing toast message. Error codes come from the main process:
 *
 * - google_oauth_client_id_missing        → build without an OAuth client
 * - google_oauth_denied:<reason>          → consent rejected (access_denied
 *                                           is Google's 403 access blocked page)
 * - google_oauth_timeout                  → user never returned from browser
 * - google_oauth_exchange_failed:<reason> → token endpoint refused the code
 * - google_drive_api_disabled             → Drive API off on the project
 */
export const reportGoogleDriveConnectError = (
  error: unknown,
  showErrorToast: ShowErrorToast,
  t: TFunction
): void => {
  const message = error instanceof Error ? error.message : "google_auth_failed";

  if (message.includes("client_id_missing")) {
    showErrorToast(t("google_drive_client_id_missing"));
    return;
  }

  if (message.includes("access_denied")) {
    showErrorToast(t("google_drive_access_blocked"));
    return;
  }

  if (message.includes("denied")) {
    showErrorToast(t("google_drive_permission_denied"));
    return;
  }

  if (message.includes("api_disabled")) {
    showErrorToast(t("google_drive_api_disabled"));
    return;
  }

  if (message.includes("invalid_grant")) {
    showErrorToast(t("google_drive_invalid_grant"));
    return;
  }

  if (message.includes("exchange_failed")) {
    showErrorToast(t("google_drive_exchange_failed"));
    return;
  }

  if (message.includes("timeout")) {
    showErrorToast(t("google_drive_auth_timeout"));
    return;
  }

  showErrorToast(t("google_drive_auth_failed"));
};
