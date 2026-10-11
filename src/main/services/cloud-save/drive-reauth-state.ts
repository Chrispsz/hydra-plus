/**
 * In-memory circuit breaker for a dead Google Drive refresh token.
 *
 * Google answers `invalid_grant` when the refresh token was revoked or
 * expired (OAuth consent screens in "Testing" mode expire refresh tokens
 * every 7 days). Before this state existed the periodic sync retried the
 * dead token on every tick forever. Now the first reauth-required error
 * trips the breaker; every successful token refresh resets it. The UI
 * already surfaces the actionable "Reconnect Google Drive" button — the
 * breaker just stops the background from hammering the door.
 */

let reauthRequired = false;
let lastLoggedState = false;

export const markDriveReauthRequired = (): void => {
  reauthRequired = true;
};

export const isDriveReauthRequired = (): boolean => reauthRequired;

export const clearDriveReauthRequired = (): void => {
  reauthRequired = false;
};

/** Logs state transitions only, so periodic ticks do not spam the log. */
export const consumeReauthLogState = (): boolean => {
  if (reauthRequired !== lastLoggedState) {
    lastLoggedState = reauthRequired;
    return true;
  }
  return false;
};
