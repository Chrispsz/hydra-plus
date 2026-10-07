import { createContext, useCallback, useEffect, useState } from "react";

import { setUserPreferences } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { UserBlocks, UserPreferences } from "@types";
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
  blockedUsers: UserBlocks["blocks"];
  fetchBlockedUsers: () => Promise<void>;
}

export const settingsContext = createContext<SettingsContext>({
  updateUserPreferences: async () => {},
  setCurrentCategoryId: () => {},
  clearSourceUrl: () => {},
  sourceUrl: null,
  currentCategoryId: "general",
  blockedUsers: [],
  fetchBlockedUsers: async () => {},
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
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [currentCategoryId, setCurrentCategoryId] =
    useState<SettingsCategoryId>(() => {
      const stored = localStorage.getItem(SETTINGS_CATEGORY_STORAGE_KEY);
      return stored && isSettingsCategoryId(stored) ? stored : "general";
    });
  const [blockedUsers, setBlockedUsers] = useState<UserBlocks["blocks"]>([]);

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

  const fetchBlockedUsers = useCallback(async () => {
    const blockedUsers = await window.electron.hydraApi
      .get<UserBlocks>("/profile/blocks", {
        params: { take: 12, skip: 0 },
      })
      .catch(() => {
        return { blocks: [] };
      });
    setBlockedUsers(blockedUsers.blocks);
  }, []);

  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const clearSourceUrl = () => setSourceUrl(null);

  const updateUserPreferences = async (values: Partial<UserPreferences>) => {
    await window.electron.updateUserPreferences(values);
    levelDBService
      .get("userPreferences", null, "json")
      .then((userPreferences) => {
        dispatch(setUserPreferences(userPreferences as UserPreferences | null));
      });
  };

  return (
    <Provider
      value={{
        updateUserPreferences,
        setCurrentCategoryId,
        clearSourceUrl,
        fetchBlockedUsers,
        currentCategoryId,
        sourceUrl,
        blockedUsers,
      }}
    >
      {children}
    </Provider>
  );
}
