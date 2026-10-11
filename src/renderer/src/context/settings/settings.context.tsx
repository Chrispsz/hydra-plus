import { createContext, useCallback, useEffect, useRef, useState } from "react";

import { setUserPreferences } from "@renderer/features";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import type { UserPreferences } from "@types";
import { useSearchParams } from "react-router-dom";

import { SETTINGS_CATEGORY_STORAGE_KEY } from "@renderer/session-state";

export type SettingsCategoryId =
  | "general"
  | "downloads"
  | "cloud"
  | "download_sources"
  | "notifications"
  | "content_gameplay"
  | "integrations"
  | "compatibility"
  | "account_privacy";

const legacyTabMap: Record<number, SettingsCategoryId> = {
  0: "general",
  1: "content_gameplay",
  2: "downloads",
  3: "general",
  4: "integrations",
  5: "account_privacy",
};

const isSettingsCategoryId = (value: string): value is SettingsCategoryId => {
  return [
    "general",
    "downloads",
    "cloud",
    "download_sources",
    "notifications",
    "content_gameplay",
    "integrations",
    "compatibility",
    "account_privacy",
  ].includes(value);
};

export interface SettingsContext {
  updateUserPreferences: (values: Partial<UserPreferences>) => Promise<void>;
  setCurrentCategoryId: React.Dispatch<
    React.SetStateAction<SettingsCategoryId>
  >;
  clearSourceUrl: () => void;
  sourceUrl: string | null;
  currentCategoryId: SettingsCategoryId;
}

export const settingsContext = createContext<SettingsContext>({
  updateUserPreferences: async () => {},
  setCurrentCategoryId: () => {},
  clearSourceUrl: () => {},
  sourceUrl: null,
  currentCategoryId: "general",
});

const { Provider } = settingsContext;
export const { Consumer: SettingsContextConsumer } = settingsContext;

export interface SettingsContextProviderProps {
  children: React.ReactNode;
}

export function SettingsContextProvider({
  children,
}: Readonly<SettingsContextProviderProps>) {
  const dispatch = useAppDispatch();
  const currentPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [currentCategoryId, setCurrentCategoryId] =
    useState<SettingsCategoryId>(() => {
      const stored = localStorage.getItem(SETTINGS_CATEGORY_STORAGE_KEY);
      return stored && isSettingsCategoryId(stored) ? stored : "general";
    });

  const [searchParams] = useSearchParams();
  const defaultSourceUrl = searchParams.get("urls");
  const defaultTab = searchParams.get("tab");

  useEffect(() => {
    localStorage.setItem(SETTINGS_CATEGORY_STORAGE_KEY, currentCategoryId);
  }, [currentCategoryId]);

  useEffect(() => {
    if (sourceUrl) setCurrentCategoryId("download_sources");
  }, [sourceUrl]);

  useEffect(() => {
    if (defaultSourceUrl) {
      setSourceUrl(defaultSourceUrl);
    }
  }, [defaultSourceUrl]);

  useEffect(() => {
    if (defaultTab) {
      if (isSettingsCategoryId(defaultTab)) {
        setCurrentCategoryId(defaultTab);
        return;
      }

      const idx = Number(defaultTab);
      if (!Number.isNaN(idx) && legacyTabMap[idx]) {
        setCurrentCategoryId(legacyTabMap[idx]);
      }
    }
  }, [defaultTab]);

  const clearSourceUrl = () => setSourceUrl(null);

  // Mirror of the redux snapshot so rapid writes in the same tick always
  // merge on top of the latest state, not a stale closure.
  const preferencesRef = useRef<UserPreferences | null>(null);
  preferencesRef.current = currentPreferences;

  const updateUserPreferences = useCallback(
    async (values: Partial<UserPreferences>) => {
      // Optimistic merge: the UI reacts instantly and checkboxes never snap
      // back while the IPC round-trip is in flight. The main process merges
      // partials and broadcasts the authoritative snapshot through
      // on-user-preferences-updated (already dispatched in app.tsx), so no
      // re-read is needed here — the old re-read raced and could land a
      // stale snapshot after a newer write.
      const base = preferencesRef.current;
      if (base) {
        const merged = { ...base, ...values };
        preferencesRef.current = merged;
        dispatch(setUserPreferences(merged));
      }

      await window.electron.updateUserPreferences(values);
    },
    [dispatch]
  );

  return (
    <Provider
      value={{
        updateUserPreferences,
        setCurrentCategoryId,
        clearSourceUrl,
        currentCategoryId,
        sourceUrl,
      }}
    >
      {children}
    </Provider>
  );
}
