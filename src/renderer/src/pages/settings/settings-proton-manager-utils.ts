import type { ProtonInstallPhase, ProtonVersion } from "@types";

/**
 * Pure view-model helpers for the Proton manager settings panel.
 *
 * Kept free of React/Electron imports so they can be unit-tested with the
 * node test runner (see settings-proton-manager-utils.test.ts).
 */

/** Phases after which the install row goes back to its idle state. */
export const isTerminalProtonInstallPhase = (
  phase: ProtonInstallPhase
): boolean => phase === "done" || phase === "error";

/**
 * Progress bar percentage for the download phase. Returns `null` while the
 * install is indeterminate (no bytes yet, or extraction/promotion phases
 * that carry no byte counters).
 */
export const getProtonInstallPercent = (
  receivedBytes?: number,
  totalBytes?: number
): number | null => {
  if (typeof receivedBytes !== "number") return null;
  if (typeof totalBytes !== "number") return null;
  if (!Number.isFinite(receivedBytes) || !Number.isFinite(totalBytes)) {
    return null;
  }
  if (totalBytes <= 0) return null;

  return Math.min(
    100,
    Math.max(0, Math.round((receivedBytes / totalBytes) * 100))
  );
};

/**
 * Normalizes a thrown/rejected error into a Proton error code, mirroring
 * the main-process convention (`message.split(":")[0]`, validated against
 * the known code set — unknown messages collapse to `proton_install_failed`).
 */
const KNOWN_PROTON_ERROR_CODES = new Set([
  "canceled",
  "proton_rate_limited",
  "proton_network_error",
  "proton_unknown_provider",
  "proton_release_not_found",
  "proton_release_invalid_asset_url",
  "proton_download_canceled",
  "proton_download_stalled",
  "proton_download_headers_timeout",
  "proton_download_failed",
  "proton_verification_failed",
  "proton_verification_size_mismatch",
  "proton_verification_digest_mismatch",
  "proton_extraction_failed",
  "proton_extraction_aborted",
  "proton_extraction_unsupported_archive",
  "proton_invalid_archive_layout",
  "proton_promote_rollback_failed",
  "proton_install_busy",
  "proton_linux_only",
  "proton_remove_failed",
  "proton_path_not_allowed",
  "proton_invalid_directory",
  "proton_install_failed",
]);

export const toProtonErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":")[0]?.trim();

  return code && KNOWN_PROTON_ERROR_CODES.has(code)
    ? code
    : "proton_install_failed";
};

/** Codes produced when the user cancels an install — not surfaced as errors. */
const PROTON_CANCELLATION_CODES = new Set([
  "canceled",
  "proton_download_canceled",
  "proton_extraction_aborted",
]);

export const isProtonCancellationCode = (code: string): boolean =>
  PROTON_CANCELLATION_CODES.has(code);

/**
 * Only builds living in a compatibilitytools.d root can be removed through
 * the manager; Steam-managed builds (steamapps/common) are Steam's business
 * and the main process refuses to delete them anyway.
 */
export const isRemovableProtonVersion = (
  version: Pick<ProtonVersion, "source">
): boolean => version.source !== "steam";

/**
 * Maps an install/release error code to the `proton_manager` i18n key used
 * inline: rate limiting has a dedicated message, cancellations are silent,
 * everything else falls back to the generic failure phase label.
 */
export const getProtonErrorI18nKey = (code: string): string | null => {
  if (isProtonCancellationCode(code)) return null;
  if (code === "proton_rate_limited") return "rate_limited";
  return "phase_error";
};
