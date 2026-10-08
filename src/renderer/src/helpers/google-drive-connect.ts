import type { TFunction } from "i18next";

type ShowErrorToast = (message: string, title?: string) => void;

const NETWORK_ERROR_PATTERN =
  /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|ERR_NETWORK|ERR_PROXY|ERR_CONNECTION/;

/**
 * Maps an error thrown by the Google Drive OAuth flow to an actionable,
 * user-facing toast message. Error codes come from the main process:
 *
 * - google_oauth_client_id_missing        → build without an OAuth client
 * - google_oauth_client_secret_missing    → build without the client secret
 *                                           (required by Google's token
 *                                           endpoint on every exchange)
 * - google_oauth_denied:<reason>          → consent rejected (access_denied
 *                                           is Google's 403 access blocked page)
 * - google_oauth_timeout                  → user never returned from browser
 * - google_oauth_exchange_failed:<reason> → token endpoint refused the code
 *                                           (invalid_client, unauthorized_client,
 *                                           network codes, …)
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

  if (message.includes("client_secret_missing")) {
    showErrorToast(t("google_drive_client_secret_missing"));
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

  if (message.includes("invalid_client")) {
    showErrorToast(t("google_drive_invalid_client"));
    return;
  }

  if (message.includes("unauthorized_client")) {
    showErrorToast(t("google_drive_unauthorized_client"));
    return;
  }

  if (NETWORK_ERROR_PATTERN.test(message)) {
    showErrorToast(t("google_drive_network_error"));
    return;
  }

  if (message.includes("exchange_failed")) {
    const reason = message.split(":").slice(1).join(":").trim() || "unknown";
    showErrorToast(t("google_drive_exchange_failed", { reason }));
    return;
  }

  if (message.includes("timeout")) {
    showErrorToast(t("google_drive_auth_timeout"));
    return;
  }

  showErrorToast(t("google_drive_auth_failed"));
};
