/// <reference types="vite/client" />

/**
 * User-configured build variables (see .env.example). They ship EMPTY in the
 * example file and are absent entirely in local/unconfigured builds — the
 * types must not promise presence, or consumers stop defending against
 * undefined and a bare method call can brick the main process at boot.
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_API_URL?: string;
  readonly MAIN_VITE_AUTH_URL?: string;
  readonly MAIN_VITE_LAUNCHER_SUBDOMAIN?: string;
  readonly MAIN_VITE_UPDATE_OWNER?: string;
  readonly MAIN_VITE_UPDATE_REPO?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string;
  readonly ELECTRON_RENDERER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
