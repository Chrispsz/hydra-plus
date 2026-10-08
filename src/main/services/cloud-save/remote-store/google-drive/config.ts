import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

/**
 * Google OAuth client configuration for the fork.
 *
 * Uses the "Desktop app" OAuth client used to link the user's Drive
 * (console.cloud.google.com → APIs & Services → Credentials, Drive API
 * enabled). Google's token endpoint requires the client secret on the
 * authorization-code exchange — even for installed/desktop clients — so the
 * secret MUST be available for linking to work. Like rclone and other OSS,
 * for desktop clients the secret is public data (PKCE protects the flow).
 *
 * Two ways to configure the pair:
 *
 *   1. Build time — MAIN_VITE_GOOGLE_CLIENT_ID / MAIN_VITE_GOOGLE_CLIENT_SECRET
 *      environment variables (what the official builds use);
 *   2. Runtime — the user pastes their own client id and secret in
 *      Settings → Cloud. Stored in LevelDB alongside the other preferences.
 *
 * Runtime configuration wins over the build-time one only when the build
 * shipped without the pair.
 */

const readOAuthPreference = async () => {
  try {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );
    return {
      clientId: userPreferences?.googleDriveClientId ?? "",
      clientSecret: userPreferences?.googleDriveClientSecret ?? "",
    };
  } catch {
    return { clientId: "", clientSecret: "" };
  }
};

export const resolveGoogleClientId = async (): Promise<string> =>
  import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ||
  (await readOAuthPreference()).clientId;

export const resolveGoogleClientSecret = async (): Promise<string> =>
  import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ||
  (await readOAuthPreference()).clientSecret;

export const hasGoogleClientId = async (): Promise<boolean> =>
  (await resolveGoogleClientId()).length > 0;

export const isGoogleClientIdConfiguredAtBuildTime = (): boolean =>
  Boolean(import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID);
