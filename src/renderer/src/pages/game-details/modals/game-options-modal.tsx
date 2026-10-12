import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@renderer/components";
import {
  formatBytes,
  GAMEMODE_SITE_URL,
  getCloudSaveAccessAction,
  getGameExecutableFilters,
  MANGOHUD_SITE_URL,
} from "@shared";

import type {
  CreateSteamShortcutOptions,
  Game,
  LibraryGame,
  ProtonVersion,
  ShortcutLocation,
} from "@types";
import { gameDetailsContext } from "@renderer/context";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import {
  useAppSelector,
  useDownload,
  useGoogleDriveCloud,
  useIsNonSteamExecutable,
  useLibrary,
  useToast,
} from "@renderer/hooks";
import { RemoveGameFromLibraryModal } from "./remove-from-library-modal";
import {
  AlertIcon,
  CloudIcon,
  DownloadIcon,
  FileDirectoryIcon,
  GearIcon,
  GlobeIcon,
} from "@primer/octicons-react";
import { Wrench } from "lucide-react";
import { OnlineModeSettingsSection } from "./game-options-modal/online-mode-section";
import { debounce } from "lodash-es";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getGameKey, getGameTitleFromExecutablePath } from "@renderer/helpers";
import "./game-options-modal.scss";
import { logger } from "@renderer/logger";
import { GameOptionsSidebar } from "./game-options-modal/sidebar";
import { GeneralSettingsSection } from "./game-options-modal/general-section";
import { CompatibilitySettingsSection } from "./game-options-modal/compatibility-section";
import { DownloadsSettingsSection } from "./game-options-modal/downloads-section";
import { DangerZoneSection } from "./game-options-modal/danger-zone-section";
import { HydraCloudV2SettingsSection } from "./game-options-modal/hydra-cloud-v2-section";
import { DriveCloudConnectCta } from "./game-options-modal/drive-connect-cta";
import type { GameSettingsCategoryId } from "./game-options-modal/types";
import { CreateSteamShortcutModal } from "./create-steam-shortcut-modal";
import { getCloudSaveVisibility } from "../cloud-save-visibility";
import {
  getAvailableGameSettingsCategory,
  shouldInitializeGameSettingsCategory,
  type GameSettingsCategoryInitializationState,
} from "./game-options-modal/category-selection";

export interface GameOptionsModalProps {
  visible: boolean;
  game: LibraryGame;
  onClose: () => void;
  onNavigateHome?: () => void;
  initialCategory?: GameSettingsCategoryId;
}

export function GameOptionsModal({
  visible,
  game,
  onClose,
  onNavigateHome,
  initialCategory,
}: Readonly<GameOptionsModalProps>) {
  const { t } = useTranslation("game_details");

  const { showSuccessToast, showErrorToast } = useToast();
  const { updateLibrary } = useLibrary();

  const {
    updateGame,
    refreshGameDetails,
    setShowRepacksModal,
    repacks,
    selectGameExecutable,
    isTransferring,
  } = useContext(gameDetailsContext);

  const [transferProgress, setTransferProgress] = useState(0);
  const [drives, setDrives] = useState<any[]>([]);
  const [transferSpeed, setTransferSpeed] = useState(0);
  const [transferETA, setTransferETA] = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRemoveGameModal, setShowRemoveGameModal] = useState(false);
  const [gameTitle, setGameTitle] = useState(game.title ?? "");
  const [updatingGameTitle, setUpdatingGameTitle] = useState(false);
  const [launchOptions, setLaunchOptions] = useState(game.launchOptions ?? "");
  const [creatingSteamShortcut, setCreatingSteamShortcut] = useState(false);
  const [saveFolderPath, setSaveFolderPath] = useState<string | null>(null);
  const [loadingSaveFolder, setLoadingSaveFolder] = useState(false);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [selectedProtonPath, setSelectedProtonPath] = useState(
    game.protonPath ?? ""
  );
  const [autoRunMangohud, setAutoRunMangohud] = useState<boolean>(
    game.autoRunMangohud === true
  );
  const [autoRunGamemode, setAutoRunGamemode] = useState<boolean>(
    game.autoRunGamemode === true
  );
  const [onlineFixEnabled, setOnlineFixEnabled] = useState<boolean>(
    game.onlineFixEnabled === true
  );
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [winetricksAvailable, setWinetricksAvailable] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<GameSettingsCategoryId>("general");
  const categoryInitializationStateRef =
    useRef<GameSettingsCategoryInitializationState>({
      visible: false,
      initialCategory,
    });
  const [defaultWinePrefixPath, setDefaultWinePrefixPath] = useState<
    string | null
  >(null);
  const [showSteamShortcutModal, setShowSteamShortcutModal] = useState(false);
  const [steamShortcutExists, setSteamShortcutExists] = useState(false);
  const {
    removeGameInstaller,
    removeGameFromLibrary,
    isGameDeleting,
    cancelDownload,
  } = useDownload();
  const { isDriveCloudActive } = useGoogleDriveCloud();
  const cloudSaveAccessAction = getCloudSaveAccessAction(isDriveCloudActive);
  const { showV2: showCloudSaveV2Settings } = getCloudSaveVisibility(
    game.shop,
    game.platform
  ).settings;
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const globalAutoRunGamemode = userPreferences?.autoRunGamemode === true;
  const globalAutoRunMangohud = userPreferences?.autoRunMangohud === true;
  const deleting = isGameDeleting(game.id);
  const { lastPacket } = useDownload();
  const isGameDownloading =
    game.download?.status === "active" && lastPacket?.gameId === game.id;

  const isNonSteamExecutable = useIsNonSteamExecutable(game);

  useEffect(() => {
    if (visible) {
      globalThis.window.electron
        .getAvailableDrives?.()
        .then(setDrives)
        .catch((err) => console.error("Failed to fetch drives:", err));
    }
  }, [visible]);

  useEffect(() => {
    if (
      visible &&
      game.shop !== "custom" &&
      globalThis.window.electron.platform === "win32"
    ) {
      setLoadingSaveFolder(true);
      setSaveFolderPath(null);
      globalThis.window.electron
        .getGameSaveFolder(game.shop, game.objectId)
        .then(setSaveFolderPath)
        .catch(() => setSaveFolderPath(null))
        .finally(() => setLoadingSaveFolder(false));
    }
  }, [visible, game.shop, game.objectId]);

  useEffect(() => {
    setGameTitle(game.title ?? "");
  }, [game.title]);
  useEffect(() => {
    setSelectedProtonPath(game.protonPath ?? "");
  }, [game.protonPath]);
  useEffect(() => {
    setAutoRunMangohud(game.autoRunMangohud === true);
  }, [game.autoRunMangohud]);
  useEffect(() => {
    setAutoRunGamemode(game.autoRunGamemode === true);
  }, [game.autoRunGamemode]);

  useEffect(() => {
    if (!visible || globalThis.window.electron.platform !== "linux") return;
    globalThis.window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]));
  }, [visible]);

  useEffect(() => {
    if (!visible || globalThis.window.electron.platform !== "linux") {
      setDefaultWinePrefixPath(null);
      return;
    }
    globalThis.window.electron
      .getDefaultWinePrefixSelectionPath()
      .then(setDefaultWinePrefixPath)
      .catch(() => setDefaultWinePrefixPath(null));
  }, [visible]);

  useEffect(() => {
    if (!visible || globalThis.window.electron.platform !== "linux") {
      setGamemodeAvailable(false);
      return;
    }
    globalThis.window.electron
      .isGamemodeAvailable()
      .then(setGamemodeAvailable)
      .catch(() => setGamemodeAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (!visible || globalThis.window.electron.platform !== "linux") {
      setMangohudAvailable(false);
      return;
    }
    globalThis.window.electron
      .isMangohudAvailable()
      .then(setMangohudAvailable)
      .catch(() => setMangohudAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (!visible || globalThis.window.electron.platform !== "linux") {
      setWinetricksAvailable(false);
      return;
    }
    globalThis.window.electron
      .isWinetricksAvailable()
      .then(setWinetricksAvailable)
      .catch(() => setWinetricksAvailable(false));
  }, [visible]);

  useEffect(() => {
    if (game.shop !== "custom") {
      globalThis.window.electron
        .checkSteamShortcut(game.shop, game.objectId)
        .then(setSteamShortcutExists)
        .catch(() => setSteamShortcutExists(false));
    }
  }, [game.shop, game.objectId]);

  useEffect(() => {
    const onProgress = (
      _: unknown,
      shop: string,
      oid: string,
      progress: number,
      details?: any
    ) => {
      if (shop === game.shop && oid === game.objectId) {
        setTransferProgress(progress);
        if (details) {
          setTransferSpeed(details.speed);
          setTransferETA(details.eta);
        }
      }
    };
    (globalThis.window.electron as any).on(
      "on-game-transfer-progress",
      onProgress
    );
    return () =>
      (globalThis.window.electron as any).off(
        "on-game-transfer-progress",
        onProgress
      );
  }, [game]);

  const debounceUpdateLaunchOptions = useRef(
    debounce(async (value: string) => {
      const gameKey = getGameKey(game.shop, game.objectId);
      const gameData = (await levelDBService.get(
        gameKey,
        "games"
      )) as Game | null;
      if (gameData) {
        const trimmed = value.trim();
        await levelDBService.put(
          gameKey,
          { ...gameData, launchOptions: trimmed || null },
          "games"
        );
      }
      updateGame();
    }, 1000)
  ).current;

  const handleRemoveGameFromLibrary = async () => {
    if (isGameDownloading) await cancelDownload(game.shop, game.objectId);
    await removeGameFromLibrary(game.shop, game.objectId);
    await Promise.all([refreshGameDetails(), updateLibrary()]);
    onClose();
    if (game.shop === "custom" && onNavigateHome) onNavigateHome();
  };

  const handleCancelTransfer = () => {
    globalThis.window.electron.cancelGameTransfer?.(game.shop, game.objectId);
    setTransferProgress(0);
    setTransferSpeed(0);
    setTransferETA(0);
    setShowCancelConfirm(false);
  };

  const getTransferErrorToast = (
    result: Awaited<
      ReturnType<typeof globalThis.window.electron.transferGameFiles>
    >
  ) => {
    const neededSpace =
      typeof result.needed === "number"
        ? formatBytes(result.needed)
        : t("transfer_unknown_size");
    const availableSpace =
      typeof result.available === "number"
        ? formatBytes(result.available)
        : t("transfer_unknown_size");

    switch (result.error) {
      case "Transfer cancelled":
        return {
          title: t("transfer_cancelled"),
        };
      case "not_enough_space":
        return {
          title: t("transfer_not_enough_space"),
          message: t("not_enough_space_detail", {
            needed: neededSpace,
            available: availableSpace,
          }),
        };
      case "Game is already in this location":
        return {
          title: t("transfer_same_folder"),
        };
      case "Destination is inside source folder":
        return {
          title: t("transfer_destination_inside_source"),
        };
      case "Destination folder already exists":
        return {
          title: t("transfer_destination_exists"),
        };
      case "Cannot access destination folder":
        return {
          title: t("transfer_destination_unavailable"),
        };
      case "Cannot determine game root folder":
        return {
          title: t("transfer_root_not_found"),
        };
      case "Game not found or has no executable path":
        return {
          title: t("transfer_game_not_found"),
        };
      case "Failed to update database":
        return {
          title: t("transfer_failed"),
          message: t("transfer_db_update_failed"),
        };
      default:
        return {
          title: t("transfer_failed"),
        };
    }
  };

  const handleStartTransfer = async (destPath: string) => {
    const result = await globalThis.window.electron.transferGameFiles(
      game.shop,
      game.objectId,
      destPath
    );
    if (!result.ok) {
      const transferErrorToast = getTransferErrorToast(result);
      showErrorToast(transferErrorToast.title, transferErrorToast.message);
      throw new Error(transferErrorToast.message ?? transferErrorToast.title);
    }
    showSuccessToast(
      t("transfer_complete"),
      t("transfer_complete_description", { game: game.title })
    );
  };

  const handleChangeExecutableLocation = async () => {
    const path = await selectGameExecutable();
    if (path) {
      const gameUsingPath =
        await globalThis.window.electron.verifyExecutablePathInUse(path);
      if (gameUsingPath) {
        showErrorToast(
          t("executable_path_in_use", { game: gameUsingPath.title })
        );
        return;
      }
      globalThis.window.electron
        .updateExecutablePath(game.shop, game.objectId, path)
        .then(updateGame);
    }
  };

  const handleCreateSteamShortcut = async (
    options?: CreateSteamShortcutOptions
  ) => {
    try {
      setCreatingSteamShortcut(true);
      await globalThis.window.electron.createSteamShortcut(
        game.shop,
        game.objectId,
        options ?? {}
      );
      showSuccessToast(
        t("create_shortcut_success"),
        t("you_might_need_to_restart_steam")
      );
      const exists = await globalThis.window.electron.checkSteamShortcut(
        game.shop,
        game.objectId
      );
      setSteamShortcutExists(exists);
      updateGame();
    } catch (error: unknown) {
      logger.error("Failed to create Steam shortcut", error);
      showErrorToast(t("create_shortcut_error"));
    } finally {
      setCreatingSteamShortcut(false);
      setShowSteamShortcutModal(false);
    }
  };

  const handleDeleteSteamShortcut = async () => {
    try {
      setCreatingSteamShortcut(true);
      await globalThis.window.electron.deleteSteamShortcut(
        game.shop,
        game.objectId
      );
      showSuccessToast(
        t("delete_shortcut_success"),
        t("you_might_need_to_restart_steam")
      );
      const exists = await globalThis.window.electron.checkSteamShortcut(
        game.shop,
        game.objectId
      );
      setSteamShortcutExists(exists);
      updateGame();
    } catch (error: unknown) {
      logger.error("Failed to delete Steam shortcut", error);
      showErrorToast(t("delete_shortcut_error"));
    } finally {
      setCreatingSteamShortcut(false);
    }
  };

  const handleCreateShortcut = async (location: ShortcutLocation) => {
    globalThis.window.electron
      .createGameShortcut(game.shop, game.objectId, location)
      .then((success: boolean) =>
        success
          ? showSuccessToast(t("create_shortcut_success"))
          : showErrorToast(t("create_shortcut_error"))
      )
      .catch(() => showErrorToast(t("create_shortcut_error")));
  };

  const handleOpenDownloadFolder = () =>
    globalThis.window.electron.openGameInstallerPath(game.shop, game.objectId);
  const handleDeleteGame = async () => {
    await removeGameInstaller(game.shop, game.objectId);
    updateGame();
  };
  const handleOpenGameExecutablePath = () =>
    globalThis.window.electron.openGameExecutablePath(game.shop, game.objectId);
  const handleOpenSaveFolder = async () => {
    if (saveFolderPath)
      await globalThis.window.electron.openGameSaveFolder(
        game.shop,
        game.objectId,
        saveFolderPath
      );
  };
  const handleClearExecutablePath = async () => {
    await globalThis.window.electron.updateExecutablePath(
      game.shop,
      game.objectId,
      null
    );
    updateGame();
  };

  const handleAddTrackingExecutable = async () => {
    const current = game.trackingExecutablePaths ?? [];
    if (current.length >= 2) return;

    const filters = getGameExecutableFilters(
      globalThis.window.electron.platform,
      {
        executable: t("game_executable"),
        allFiles: t("all_files"),
      }
    );

    const { filePaths } = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile"],
      defaultPath: game.executablePath ?? undefined,
      filters,
    });

    const path = filePaths?.[0];
    if (!path || current.includes(path)) return;

    await globalThis.window.electron.updateTrackingExecutablePaths(
      game.shop,
      game.objectId,
      [...current, path]
    );
    updateGame();
  };

  const handleRemoveTrackingExecutable = async (index: number) => {
    const current = game.trackingExecutablePaths ?? [];
    await globalThis.window.electron.updateTrackingExecutablePaths(
      game.shop,
      game.objectId,
      current.filter((_, itemIndex) => itemIndex !== index)
    );
    updateGame();
  };

  const handleChangeWinePrefixPath = async () => {
    const defaultPath =
      await globalThis.window.electron.getDefaultWinePrefixSelectionPath();
    const { filePaths } = await globalThis.window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: game?.winePrefixPath ?? defaultPath ?? "",
    });
    if (filePaths?.length) {
      try {
        await globalThis.window.electron.selectGameWinePrefix(
          game.shop,
          game.objectId,
          filePaths[0]
        );
        await updateGame();
      } catch {
        showErrorToast(
          t("invalid_wine_prefix_path"),
          t("invalid_wine_prefix_path_description")
        );
      }
    }
  };

  const handleClearWinePrefixPath = async () => {
    await globalThis.window.electron.selectGameWinePrefix(
      game.shop,
      game.objectId,
      null
    );
    updateGame();
  };
  const handleOpenWinetricks = async () => {
    const success = await globalThis.window.electron.openGameWinetricks(
      game.shop,
      game.objectId
    );
    success
      ? showSuccessToast(t("winetricks_opened"))
      : showErrorToast(t("winetricks_open_error"));
  };

  const handleChangeMangohudState = async (value: boolean) => {
    setAutoRunMangohud(value);
    await globalThis.window.electron.toggleGameMangohud(
      game.shop,
      game.objectId,
      value
    );
    updateGame();
  };
  const handleChangeGamemodeState = async (value: boolean) => {
    setAutoRunGamemode(value);
    await globalThis.window.electron.toggleGameGamemode(
      game.shop,
      game.objectId,
      value
    );
    updateGame();
  };

  const handleChangeOnlineFixState = async (value: boolean) => {
    setOnlineFixEnabled(value);
    try {
      await globalThis.window.electron.setGameOnlineFixMode(
        game.shop,
        game.objectId,
        value
      );
      updateGame();
    } catch {
      setOnlineFixEnabled(!value);
    }
  };

  const applyProtonPathChange = async (protonPath: string) => {
    try {
      await globalThis.window.electron.selectGameProtonPath(
        game.shop,
        game.objectId,
        protonPath || null
      );
      await updateGame();
    } catch {
      setSelectedProtonPath(game.protonPath ?? "");
      showErrorToast(t("proton_version_update_error"));
    }
  };

  const handleChangeLaunchOptions = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const v = event.target.value;
    setLaunchOptions(v);
    debounceUpdateLaunchOptions(v);
  };
  const handleChangeGameTitle = (event: React.ChangeEvent<HTMLInputElement>) =>
    setGameTitle(event.target.value);

  const handleBlurGameTitle = async () => {
    if (updatingGameTitle) return;
    const trimmed = gameTitle.trim();
    if (!trimmed) {
      setGameTitle(game.title ?? "");
      showErrorToast(t("edit_game_modal_fill_required"));
      return;
    }
    if (trimmed === (game.title ?? "").trim()) {
      setGameTitle(game.title ?? "");
      return;
    }
    setUpdatingGameTitle(true);
    try {
      if (game.shop === "custom") {
        await globalThis.window.electron.updateCustomGame({
          shop: game.shop,
          objectId: game.objectId,
          title: trimmed,
          iconUrl: game.iconUrl || undefined,
          logoImageUrl: game.logoImageUrl || undefined,
          libraryHeroImageUrl: game.libraryHeroImageUrl || undefined,
        });
      } else {
        await globalThis.window.electron.updateGameCustomAssets({
          shop: game.shop,
          objectId: game.objectId,
          title: trimmed,
        });
      }
      await Promise.all([updateGame(), updateLibrary()]);
      setGameTitle(trimmed);
    } catch (error) {
      setGameTitle(game.title ?? "");
      showErrorToast(
        error instanceof Error ? error.message : t("edit_game_modal_failed")
      );
    } finally {
      setUpdatingGameTitle(false);
    }
  };

  const handleResetGameTitle = useCallback(async () => {
    if (!game || updatingGameTitle) return;

    if (game.shop === "custom") {
      const defaultTitle = game.executablePath
        ? getGameTitleFromExecutablePath(game.executablePath).trim()
        : "";
      if (!defaultTitle) return;

      setUpdatingGameTitle(true);

      try {
        await globalThis.window.electron.updateCustomGame({
          shop: game.shop,
          objectId: game.objectId,
          title: defaultTitle,
          iconUrl: game.iconUrl || undefined,
          logoImageUrl: game.logoImageUrl || undefined,
          libraryHeroImageUrl: game.libraryHeroImageUrl || undefined,
        });
        await Promise.all([updateGame(), updateLibrary()]);
        setGameTitle(defaultTitle);
      } catch {
        showErrorToast(t("edit_game_modal_failed"));
      } finally {
        setUpdatingGameTitle(false);
      }
      return;
    }

    setUpdatingGameTitle(true);

    try {
      const assets = await globalThis.window.electron.getGameAssets(
        game.objectId,
        game.shop,
        { forceFresh: true }
      );

      if (assets?.title) {
        await globalThis.window.electron.updateGameCustomAssets({
          shop: game.shop,
          objectId: game.objectId,
          title: assets.title,
        });

        await Promise.all([updateGame(), updateLibrary()]);
        setGameTitle(assets.title);
      }
    } catch {
      showErrorToast(t("edit_game_modal_failed"));
    } finally {
      setUpdatingGameTitle(false);
    }
  }, [game, updatingGameTitle, showErrorToast, t, updateGame, updateLibrary]);

  const handleChangeProtonVersion = (value: string) => {
    setSelectedProtonPath(value);
    if (value !== (game.protonPath ?? "")) applyProtonPathChange(value);
  };

  const handleClearLaunchOptions = async () => {
    setLaunchOptions("");
    const gameKey = getGameKey(game.shop, game.objectId);
    const gameData = (await levelDBService.get(
      gameKey,
      "games"
    )) as Game | null;
    if (gameData)
      await levelDBService.put(
        gameKey,
        { ...gameData, launchOptions: null },
        "games"
      );
    updateGame();
  };

  const isLaunchbox = game.shop === "launchbox";
  const showDownloadSettings = game.shop !== "custom";
  const shouldShowWinePrefixConfiguration =
    globalThis.window.electron.platform === "linux";
  const defaultHydraWinePrefixPath = defaultWinePrefixPath
    ? `${defaultWinePrefixPath}/${game.objectId}`
    : null;
  const displayedWinePrefixPath =
    game.winePrefixPath ?? defaultHydraWinePrefixPath;

  const categories = useMemo(
    () => [
      {
        id: "general" as const,
        label: t("settings_category_general"),
        icon: <GearIcon size={16} />,
      },
      ...(isLaunchbox
        ? []
        : [
            {
              id: "locations" as const,
              label: t("settings_category_locations"),
              icon: <FileDirectoryIcon size={16} />,
            },
          ]),
      ...(showCloudSaveV2Settings
        ? [
            {
              id: "hydra_cloud" as const,
              label: t("settings_category_hydra_cloud"),
              icon: <CloudIcon size={16} />,
            },
          ]
        : []),
      ...(shouldShowWinePrefixConfiguration
        ? [
            {
              id: "compatibility" as const,
              label: t("settings_category_compatibility"),
              icon: <Wrench size={16} />,
            },
          ]
        : []),
      {
        id: "online" as const,
        label: t("settings_category_online"),
        icon: <GlobeIcon size={16} />,
      },
      ...(showDownloadSettings
        ? [
            {
              id: "downloads" as const,
              label: t("settings_category_downloads"),
              icon: <DownloadIcon size={16} />,
            },
          ]
        : []),
      {
        id: "danger_zone" as const,
        label: t("settings_category_danger_zone"),
        icon: <AlertIcon size={16} />,
      },
    ],
    [
      cloudSaveAccessAction,
      isLaunchbox,
      showCloudSaveV2Settings,
      showDownloadSettings,
      shouldShowWinePrefixConfiguration,
      t,
    ]
  );

  useEffect(() => {
    const currentInitializationState = { visible, initialCategory };
    const shouldInitialize = shouldInitializeGameSettingsCategory(
      categoryInitializationStateRef.current,
      currentInitializationState
    );
    categoryInitializationStateRef.current = currentInitializationState;

    if (!shouldInitialize) return;

    const category = initialCategory ?? "general";
    const availableCategory = getAvailableGameSettingsCategory(category, {
      cloudSaveAccessAction,
      showCloudSaveV2Settings,
      showDownloadSettings,
    });

    setSelectedCategory(availableCategory);
  }, [
    cloudSaveAccessAction,
    initialCategory,
    showDownloadSettings,
    showCloudSaveV2Settings,
    visible,
  ]);

  useEffect(() => {
    if (!visible) return;

    setSelectedCategory((currentCategory) =>
      getAvailableGameSettingsCategory(currentCategory, {
        cloudSaveAccessAction,
        showCloudSaveV2Settings,
        showDownloadSettings,
      })
    );
  }, [
    cloudSaveAccessAction,
    showCloudSaveV2Settings,
    showDownloadSettings,
    visible,
  ]);

  const handleSelectCategory = (category: typeof selectedCategory) => {
    if (category === "hydra_cloud" && !showCloudSaveV2Settings) {
      return;
    }
    setSelectedCategory(category);
  };
  const shouldShowCreateStartMenuShortcut =
    globalThis.window.electron.platform === "win32";

  const handleToggleHydraPlaytimeEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await globalThis.window.electron.setGameHydraPlaytimeEnabled(
          game.shop,
          game.objectId,
          enabled
        );
        await updateGame();
      } catch {
        showErrorToast(t("steam_playtime_tracking_error"));
      }
    },
    [game.objectId, game.shop, showErrorToast, t, updateGame]
  );

  const baseGeneralSettingsProps = useMemo(
    () => ({
      game,
      gameTitle,
      launchOptions,
      updatingGameTitle,
      creatingSteamShortcut,
      shouldShowCreateStartMenuShortcut,
      shouldShowWinePrefixConfiguration,
      loadingSaveFolder,
      saveFolderPath,
      steamShortcutExists,
      onChangeExecutableLocation: handleChangeExecutableLocation,
      onClearExecutablePath: handleClearExecutablePath,
      onOpenGameExecutablePath: handleOpenGameExecutablePath,
      onOpenSaveFolder: handleOpenSaveFolder,
      onCreateShortcut: handleCreateShortcut,
      onCreateSteamShortcut: () => setShowSteamShortcutModal(true),
      onDeleteSteamShortcut: handleDeleteSteamShortcut,
      onChangeGameTitle: handleChangeGameTitle,
      onBlurGameTitle: handleBlurGameTitle,
      onResetGameTitle: handleResetGameTitle,
      onChangeLaunchOptions: handleChangeLaunchOptions,
      onClearLaunchOptions: handleClearLaunchOptions,
      onToggleHydraPlaytimeEnabled: handleToggleHydraPlaytimeEnabled,
      isNonSteamExecutable,
      isTransferring,
      transferProgress,
      drives,
      onStartTransfer: handleStartTransfer,
      onCancelDriveSelection: () => {},
      transferSpeed,
      transferETA,
      showCancelConfirm,
      onShowCancelConfirm: () => setShowCancelConfirm(true),
      onHideCancelConfirm: () => setShowCancelConfirm(false),
      onConfirmCancelTransfer: handleCancelTransfer,
    }),
    [
      game,
      gameTitle,
      launchOptions,
      updatingGameTitle,
      creatingSteamShortcut,
      shouldShowCreateStartMenuShortcut,
      shouldShowWinePrefixConfiguration,
      loadingSaveFolder,
      saveFolderPath,
      steamShortcutExists,
      handleChangeExecutableLocation,
      handleClearExecutablePath,
      handleOpenGameExecutablePath,
      handleOpenSaveFolder,
      handleCreateShortcut,
      handleDeleteSteamShortcut,
      handleChangeGameTitle,
      handleBlurGameTitle,
      handleResetGameTitle,
      handleChangeLaunchOptions,
      handleClearLaunchOptions,
      handleToggleHydraPlaytimeEnabled,
      isNonSteamExecutable,
      isTransferring,
      transferProgress,
      drives,
      handleStartTransfer,
      transferSpeed,
      transferETA,
      showCancelConfirm,
      handleCancelTransfer,
    ]
  );

  return (
    <>
      <DeleteGameModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={handleDeleteGame}
      />
      <RemoveGameFromLibraryModal
        visible={showRemoveGameModal}
        onClose={() => setShowRemoveGameModal(false)}
        removeGameFromLibrary={handleRemoveGameFromLibrary}
        game={game}
      />
      <CreateSteamShortcutModal
        visible={showSteamShortcutModal}
        creating={creatingSteamShortcut}
        onClose={() => setShowSteamShortcutModal(false)}
        onConfirm={handleCreateSteamShortcut}
      />

      <Modal
        visible={visible}
        title={game.title}
        onClose={onClose}
        large={true}
        noContentPadding
      >
        <div className="game-options-modal__container">
          <GameOptionsSidebar
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
          />
          <div className="game-options-modal__panel">
            {selectedCategory === "general" && (
              <GeneralSettingsSection
                {...baseGeneralSettingsProps}
                showExecutableSection={isLaunchbox}
                showTransferSection={false}
                showLaunchOptionsSection={!isLaunchbox}
              />
            )}
            {selectedCategory === "locations" && (
              <GeneralSettingsSection
                {...baseGeneralSettingsProps}
                onAddTrackingExecutable={handleAddTrackingExecutable}
                onRemoveTrackingExecutable={handleRemoveTrackingExecutable}
                showTitleSection={false}
                showShortcutsSection={false}
                showLaunchOptionsSection={false}
                showSteamPlaytimeSection={false}
              />
            )}
            {selectedCategory === "hydra_cloud" &&
              showCloudSaveV2Settings &&
              (cloudSaveAccessAction === "connect-drive" ? (
                <DriveCloudConnectCta />
              ) : (
                <HydraCloudV2SettingsSection
                  onSelectExecutable={() =>
                    setSelectedCategory(isLaunchbox ? "general" : "locations")
                  }
                />
              ))}
            {selectedCategory === "compatibility" &&
              shouldShowWinePrefixConfiguration && (
                <CompatibilitySettingsSection
                  game={game}
                  displayedWinePrefixPath={displayedWinePrefixPath}
                  protonVersions={protonVersions}
                  selectedProtonPath={selectedProtonPath}
                  autoRunGamemode={autoRunGamemode}
                  autoRunMangohud={autoRunMangohud}
                  globalAutoRunGamemode={globalAutoRunGamemode}
                  globalAutoRunMangohud={globalAutoRunMangohud}
                  gamemodeAvailable={gamemodeAvailable}
                  mangohudAvailable={mangohudAvailable}
                  winetricksAvailable={winetricksAvailable}
                  gamemodeSiteUrl={GAMEMODE_SITE_URL}
                  mangohudSiteUrl={MANGOHUD_SITE_URL}
                  onChangeWinePrefixPath={handleChangeWinePrefixPath}
                  onClearWinePrefixPath={handleClearWinePrefixPath}
                  onOpenWinetricks={handleOpenWinetricks}
                  onChangeGamemodeState={handleChangeGamemodeState}
                  onChangeMangohudState={handleChangeMangohudState}
                  onChangeProtonVersion={handleChangeProtonVersion}
                />
              )}
            {selectedCategory === "online" && (
              <OnlineModeSettingsSection
                shop={game.shop}
                objectId={game.objectId}
                onlineFixEnabled={onlineFixEnabled}
                onChangeOnlineFixState={handleChangeOnlineFixState}
              />
            )}
            {selectedCategory === "downloads" && showDownloadSettings && (
              <DownloadsSettingsSection
                game={game}
                deleting={deleting}
                isGameDownloading={isGameDownloading}
                repacksLength={repacks.length}
                onOpenRepacks={() => setShowRepacksModal(true)}
                onOpenDownloadFolder={handleOpenDownloadFolder}
              />
            )}
            {selectedCategory === "danger_zone" && (
              <DangerZoneSection
                game={game}
                deleting={deleting}
                isGameDownloading={isGameDownloading}
                onOpenRemoveFromLibrary={() => setShowRemoveGameModal(true)}
                onOpenRemoveFiles={() => setShowDeleteModal(true)}
              />
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
