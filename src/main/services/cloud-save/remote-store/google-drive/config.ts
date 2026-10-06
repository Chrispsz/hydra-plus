/**
 * Google OAuth client configuration for the fork.
 *
 * The fork publisher creates a "Desktop app" OAuth client in a Google Cloud
 * project (console.cloud.google.com → APIs & Services → Credentials) with
 * the Drive API enabled, and injects the client id at build time. The
 * client secret is NOT required: we use the PKCE flow for installed apps.
 */
export const getGoogleClientId = (): string =>
  import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? "";

export const hasGoogleClientId = (): boolean => getGoogleClientId().length > 0;
