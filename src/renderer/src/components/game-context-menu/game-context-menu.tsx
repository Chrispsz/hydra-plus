import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { HeartIcon, HeartFillIcon } from "@primer/octicons-react";
import {
  PlayIcon,
  DownloadIcon,
  GearIcon,
  PencilIcon,
  FileDirectoryIcon,
  LinkIcon,
  TrashIcon,
  XIcon,
  PinIcon,
  PinSlashIcon,
  LockIcon,
} from "@primer/octicons-react";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import {
  ContextMenu,
  ContextMenuItemData,
  ContextMenuProps,
  useGameActions,
} from "..";
import { useToast } from "@renderer/hooks";
import { RemoveGameFromLibraryModal } from "@renderer/pages/game-details/modals/remove-from-library-modal";
import { DeleteGameModal } from "@renderer/pages/downloads/delete-game-modal";
import type { GameContextMenuGame } from "./game-context-menu.types";

interface GameContextMenuProps extends Omit<ContextMenuProps, "items"> {
  game: GameContextMenuGame;
  onPinToggle?: () => void;
  isPinned?: boolean;
}

export function GameContextMenu({
  game,
  onPinToggle,
  isPinned,
  visible,
  position,
  onClose,
}: GameContextMenuProps) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const [showConfirmRemoveLibrary, setShowConfirmRemoveLibrary] =
    useState(false);
  const [showConfirmRemoveFiles, setShowConfirmRemoveFiles] = useState(false);
  const [isFavoriteSelected, setIsFavoriteSelected] = useState(
    Boolean(game.favorite)
  );
  const [isFavoritePending, setIsFavoritePending] = useState(false);
  const [isVisibilityPending, setIsVisibilityPending] = useState(false);
  const [isConcealed, setIsConcealed] = useState(Boolean(game.isConcealed));
  const {
    canPlay,
    isDeleting,
    isGameDownloading,
    isGameRunning,
    hasRepacks,
    creatingShortcut,
    creatingSteamShortcut,
    handlePlayGame,
    handleCloseGame,
    handleToggleFavorite,
    handleCreateShortcut,
    handleCreateSteamShortcut,
    handleOpenFolder,
    handleOpenDownloadOptions,
    handleOpenDownloadLocation,
    handleTogglePin,
    handleRemoveFromLibrary,
    handleRemoveFiles,
    handleOpenGameOptions,
  } = useGameActions(game);

  useEffect(() => {
    if (!visible) return;

    setIsFavoriteSelected(Boolean(game.favorite));
    setIsFavoritePending(false);
    setIsVisibilityPending(false);
    setIsConcealed(Boolean(game.isConcealed));
  }, [visible, game]);

  const handleConcealChange = async (value: boolean) => {
    if (isVisibilityPending) return;
    setIsVisibilityPending(true);
    try {
      const saved = await window.electron.setGameVisibility(
        game.shop,
        game.objectId,
        value
      );
      setIsConcealed(Boolean(saved.isConcealed));
      window.dispatchEvent(new Event("hydra:game-visibility-updated"));
      showSuccessToast(t("game_visibility_updated"));
      onClose();
    } catch {
      showErrorToast(t("failed_update_game_visibility"));
    } finally {
      setIsVisibilityPending(false);
    }
  };

  const handleToggleFavoriteStatus = async () => {
    if (isFavoritePending) return;

    setIsFavoritePending(true);

    try {
      await handleToggleFavorite(isFavoriteSelected);
      setIsFavoriteSelected((currentValue) => !currentValue);
    } catch (error) {
      void error;
    } finally {
      setIsFavoritePending(false);
    }
  };

  const items: ContextMenuItemData[] = [
    {
      id: "play",
      label: isGameRunning ? t("close") : canPlay ? t("play") : t("download"),
      icon: isGameRunning ? (
        <XIcon size={16} />
      ) : canPlay ? (
        <PlayIcon size={16} />
      ) : (
        <DownloadIcon size={16} />
      ),
      onClick: () => {
        if (isGameRunning) {
          void handleCloseGame();
        } else if (canPlay) {
          void handlePlayGame();
        } else {
          handleOpenDownloadOptions();
        }
      },
      disabled: isDeleting,
    },
    {
      id: "favorite",
      label: t("favorites", { ns: "sidebar" }),
      icon: isFavoriteSelected ? (
        <HeartFillIcon size={16} />
      ) : (
        <HeartIcon size={16} />
      ),
      onClick: () => {
        void handleToggleFavoriteStatus();
      },
      closeOnClick: false,
      disabled: isDeleting,
    },
    ...(game.executablePath
      ? [
          {
            id: "shortcuts",
            label: t("create_shortcut_simple"),
            icon: <LinkIcon size={16} />,
            disabled: isDeleting,
            submenu: [
              {
                id: "desktop-shortcut",
                label: t("create_shortcut_simple"),
                icon: <LinkIcon size={16} />,
                onClick: handleCreateShortcut,
                disabled: isDeleting || creatingShortcut,
              },
              {
                id: "steam-shortcut",
                label: t("create_steam_shortcut"),
                icon: <SteamLogo style={{ width: 16, height: 16 }} />,
                onClick: handleCreateSteamShortcut,
                disabled: isDeleting || creatingSteamShortcut,
              },
            ],
          },
        ]
      : []),

    {
      id: "manage",
      label: t("options"),
      icon: <GearIcon size={16} />,
      disabled: isDeleting,
      submenu: [
        {
          id: "conceal-game",
          label: isConcealed ? t("reveal_game") : t("conceal_game"),
          icon: <LockIcon size={16} />,
          onClick: () => void handleConcealChange(!isConcealed),
          closeOnClick: false,
          disabled: isDeleting || isVisibilityPending || game.shop === "custom",
        },
        {
          id: "pin-game",
          label:
            (isPinned ?? game.isPinned ?? false)
              ? t("unpin_game")
              : t("pin_game"),
          icon:
            (isPinned ?? game.isPinned ?? false) ? (
              <PinSlashIcon size={16} />
            ) : (
              <PinIcon size={16} />
            ),
          onClick: onPinToggle ?? handleTogglePin,
          disabled: isDeleting,
        },
        ...(game.executablePath
          ? [
              {
                id: "open-folder",
                label: t("open_folder"),
                icon: <FileDirectoryIcon size={16} />,
                onClick: handleOpenFolder,
                disabled: isDeleting,
              },
            ]
          : []),
        ...(game.executablePath
          ? [
              {
                id: "download-options",
                label: t("open_download_options"),
                icon: <DownloadIcon size={16} />,
                onClick: handleOpenDownloadOptions,
                disabled: isDeleting || isGameDownloading || !hasRepacks,
              },
            ]
          : []),
        ...(game.download?.downloadPath
          ? [
              {
                id: "download-location",
                label: t("open_download_location"),
                icon: <FileDirectoryIcon size={16} />,
                onClick: handleOpenDownloadLocation,
                disabled: isDeleting,
              },
            ]
          : []),

        {
          id: "remove-library",
          label: t("remove_from_library"),
          icon: <XIcon size={16} />,
          onClick: () => setShowConfirmRemoveLibrary(true),
          disabled: isDeleting,
          danger: true,
          closeOnClick: false,
        },
        ...(game.download?.downloadPath
          ? [
              {
                id: "remove-files",
                label: t("remove_files"),
                icon: <TrashIcon size={16} />,
                onClick: () => setShowConfirmRemoveFiles(true),
                disabled: isDeleting || isGameDownloading,
                danger: true,
                closeOnClick: false,
              },
            ]
          : []),
      ],
    },
    {
      id: "properties",
      label: t("properties"),
      separator: true,
      icon: <PencilIcon size={16} />,
      onClick: () => handleOpenGameOptions(),
      disabled: isDeleting,
    },
  ];

  let forceOpenSubmenuId: string | undefined;
  if (showConfirmRemoveLibrary || showConfirmRemoveFiles) {
    forceOpenSubmenuId = "manage";
  }

  return (
    <>
      <ContextMenu
        items={items}
        visible={visible}
        position={position}
        onClose={onClose}
        forceOpenSubmenuId={forceOpenSubmenuId}
        className={
          !game.executablePath ? "context-menu--game-not-installed" : undefined
        }
      />

      <RemoveGameFromLibraryModal
        visible={showConfirmRemoveLibrary}
        game={game}
        onClose={() => setShowConfirmRemoveLibrary(false)}
        removeGameFromLibrary={async () => {
          setShowConfirmRemoveLibrary(false);
          onClose();
          await handleRemoveFromLibrary();
        }}
      />

      <DeleteGameModal
        visible={showConfirmRemoveFiles}
        onClose={() => setShowConfirmRemoveFiles(false)}
        deleteGame={() => {
          setShowConfirmRemoveFiles(false);
          onClose();
          void handleRemoveFiles();
        }}
      />
    </>
  );
}
