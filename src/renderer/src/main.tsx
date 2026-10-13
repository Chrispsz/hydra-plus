import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import { lazy, Suspense } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import "@fontsource/noto-sans/latin-400.css";
import "@fontsource/noto-sans/latin-500.css";
import "@fontsource/noto-sans/latin-700.css";

import "react-loading-skeleton/dist/skeleton.css";
import "react-tooltip/dist/react-tooltip.css";

import { GameOptionsModalProvider } from "@renderer/context/game-options-modal/game-options-modal.context";

import { App } from "./app";

import { store } from "./store";

import resources from "@locales";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import { clearStateFromPreviousSession } from "./session-state";
import { ErrorBoundary } from "./components/error-boundary/error-boundary";
import { levelDBService } from "./services/leveldb.service";
import Home from "./pages/home/home";

/**
 * Route-level code splitting: only Home (the landing page) ships in the
 * main chunk; every other page is fetched on first navigation. The
 * renderer loads chunks from local disk, so the lazy hop is negligible
 * while keeping the initial bundle small.
 */
const Catalogue = lazy(() => import("./pages/catalogue/catalogue"));
const Downloads = lazy(() => import("./pages/downloads/downloads"));
const GameDetails = lazy(() => import("./pages/game-details/game-details"));
const Settings = lazy(() => import("./pages/settings/settings"));
const Library = lazy(() => import("./pages/library/library"));
const GameLauncher = lazy(() => import("./pages/game-launcher/game-launcher"));
const AuthWindow = lazy(() => import("./pages/auth-window/auth-window"));

console.log = logger.log;

globalThis.addEventListener("unhandledrejection", (event) => {
  logger.error("Unhandled promise rejection", event.reason);
});

globalThis.addEventListener("error", (event) => {
  logger.error("Uncaught error", event.error ?? event.message);
});

const isStaging = await globalThis.electron.isStaging();
addCookieInterceptor(isStaging);

await clearStateFromPreviousSession();

const syncDocumentLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
};

// Hydra Plus ships only pt-BR and English; Portuguese is the default
// language. A saved preference is honored only when it is one of the two
// supported locales (older installs may carry a removed language).
await i18n.use(initReactI18next).init({
  resources,
  lng: "pt-BR",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

const userPreferences = (await levelDBService.get(
  "userPreferences",
  null,
  "json"
)) as { language?: string } | null;

const savedLanguage = userPreferences?.language;

if (savedLanguage === "en" || savedLanguage === "pt-BR") {
  await i18n.changeLanguage(savedLanguage);
} else {
  await i18n.changeLanguage("pt-BR");
  globalThis.electron.updateUserPreferences({ language: "pt-BR" });
}

syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

// Every BrowserWindow runs its own renderer with its own i18n instance, so a
// language change must be applied per-window. Subscribe here (the shared entry
// for all routes) so detached windows — game-launcher, auth, etc. — react
// too, not just the routes mounted under <App />.
globalThis.electron.onUserPreferencesUpdated((preferences) => {
  if (preferences?.language && preferences.language !== i18n.language) {
    i18n.changeLanguage(preferences.language).catch((error) => {
      console.error("Failed to change language", error);
    });
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ErrorBoundary>
        <HashRouter>
          <GameOptionsModalProvider>
            <Suspense fallback={null}>
              <Routes>
                <Route element={<App />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/catalogue" element={<Catalogue />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="/downloads" element={<Downloads />} />
                  <Route
                    path="/game/:shop/:objectId"
                    element={<GameDetails />}
                  />
                  <Route path="/settings" element={<Settings />} />
                </Route>

                <Route path="/game-launcher" element={<GameLauncher />} />
                <Route path="/auth-window" element={<AuthWindow />} />
              </Routes>
            </Suspense>
          </GameOptionsModalProvider>
        </HashRouter>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
