/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_API_URL: string;
  readonly MAIN_VITE_ANALYTICS_API_URL: string;
  readonly MAIN_VITE_AUTH_URL: string;
  readonly MAIN_VITE_CHECKOUT_URL: string;
  readonly MAIN_VITE_EXTERNAL_RESOURCES_URL: string;
  readonly MAIN_VITE_LAUNCHER_SUBDOMAIN: string;
  readonly MAIN_VITE_UPDATE_OWNER: string;
  readonly MAIN_VITE_UPDATE_REPO: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_ID: string;
  readonly ELECTRON_RENDERER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
