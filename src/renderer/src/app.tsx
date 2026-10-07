import { BottomPanel, Header, Sidebar, Toast } from "@renderer/components";
import {
  DashIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useDownloadOptionsListener } from "@renderer/hooks/use-download-options-listener";
import i18n from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearExtraction,
  closeToast,
  setExtractionProgress,
  setGameRunning,
  setLibrarySyncingRemote,
  setProfileBackground,
  setUserDetails,
  setUserPreferences,
  toggleDraggingDisabled,
} from "@renderer/features";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSubscription } from "./hooks/use-subscription";
import { ArchiveDeletionModal } from "./pages/downloads/archive-deletion-error-modal";
import { CloudSubscriptionModal } from "./pages/shared-modals/hydra-cloud/cloud-subscription-modal";
import { AddFriendModal } from "./pages/profile/profile-content/add-friend-modal";
import { CloudGiftNotificationModal } from "./pages/shared-modals/cloud-gift-notification-modal";

import type { UserPreferences } from "@types";
import "./app.scss";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
  injectCustomCss,
  removeCustomCss,
} from "./helpers";
import { levelDBService } from "./services/leveldb.service";

export interface AppProps {
  children: React.ReactNode;
}

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const { updateLibrary, library, downloadLibrary } = useLibrary();

  // Listen for new download options updates
  useDownloadOptionsListener();

  const { t } = useTranslation("app");

  const { clearDownload, setLastPacket, lastPacket } = useDownload();

  const {
    hasActiveSubscription,
    fetchUserDetails,
    updateUserDetails,
    clearUserDetails,
  } = useUserDetails();

  const { hideHydraCloudModal, isHydraCloudModalVisible, hydraCloudFeature } =
    useSubscription();

  const dispatch = useAppDispatch();

  const navigate = useNavigate();
  const location = useLocation();

  const draggingDisabled = useAppSelector(
    (state) => state.window.draggingDisabled
  );

  const toast = useAppSelector((state) => state.toast);

  const { showSuccessToast, showErrorToast } = useToast();

  const [showArchiveDeletionModal, setShowArchiveDeletionModal] =
    useState(false);
  const [archivePaths, setArchivePaths] = useState<string[]>([]);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);

  useEffect(() => {
    Promise.all([
      levelDBService.get("userPreferences", null, "json"),
      updateLibrary(),
    ]).then(([preferences]) => {
      dispatch(setUserPreferences(preferences as UserPreferences | null));
    });
  }, [navigate, location.pathname, dispatch, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onUserPreferencesUpdated(
      (preferences) => {
        if (!preferences) {
          dispatch(setUserPreferences(null));
          return;
        }

        if (preferences.language && preferences.language !== i18n.language) {
          void i18n.changeLanguage(preferences.language);
        }

        dispatch(setUserPreferences(preferences));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onDownloadProgress(
      (downloadProgress) => {
        if (
          downloadProgress?.progress === 1 &&
          !downloadProgress.isCheckingFiles &&
          !downloadProgress.isDownloadingMetadata
        ) {
          clearDownload();
          updateLibrary();
          return;
        }

        setLastPacket(downloadProgress);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [clearDownload, setLastPacket, updateLibrary]);

  useEffect(() => {
    const unsubscribe = window.electron.onHardDelete(() => {
      updateLibrary();
    });

    return () => unsubscribe();
  }, [updateLibrary]);

  useEffect(() => {
    if (!lastPacket?.gameId) return;

    const activeGame = downloadLibrary.find(
      (game) => game.id === lastPacket.gameId
    );

    if (!activeGame || activeGame.download?.status !== "active") {
      clearDownload();
    }
  }, [clearDownload, lastPacket?.gameId, downloadLibrary]);

  const bootstrapUserDetails = useCallback(async () => {
    const cachedUserDetails = window.localStorage.getItem("userDetails");

    if (cachedUserDetails) {
      const { profileBackground, ...userDetails } =
        JSON.parse(cachedUserDetails);

      dispatch(setUserDetails(userDetails));
      dispatch(setProfileBackground(profileBackground));
    }

    const userDetails = await fetchUserDetails().catch(() => null);

    if (userDetails) {
      updateUserDetails(userDetails);
    }
  }, [fetchUserDetails, updateUserDetails, dispatch]);

  useEffect(() => {
    bootstrapUserDetails();
  }, [bootstrapUserDetails]);

  const onSignIn = useCallback(() => {
    fetchUserDetails().then((response) => {
      if (response) {
        updateUserDetails(response);
        showSuccessToast(t("successfully_signed_in"));
      }
    });
  }, [fetchUserDetails, t, showSuccessToast, updateUserDetails]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesRunning) => {
      if (gamesRunning.length) {
        const lastGame = gamesRunning[gamesRunning.length - 1];
        const libraryGame = library.find(
          (library) => library.id === lastGame.id
        );

        if (libraryGame) {
          dispatch(
            setGameRunning({
              ...libraryGame,
              coverImageUrl: libraryGame.coverImageUrl ?? null,
              sessionDurationInMillis: lastGame.sessionDurationInMillis,
            })
          );
          return;
        }
      }
      dispatch(setGameRunning(null));
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, library]);

  useEffect(() => {
    let hasReceivedSyncState = false;

    void window.electron.getRemoteLibrarySyncState().then((syncing) => {
      if (!hasReceivedSyncState) dispatch(setLibrarySyncingRemote(syncing));
    });

    return window.electron.onRemoteLibrarySyncStateChange((syncing) => {
      hasReceivedSyncState = true;

      if (syncing) {
        dispatch(setLibrarySyncingRemote(true));
        return;
      }

      void updateLibrary().finally(() =>
        dispatch(setLibrarySyncingRemote(false))
      );
    });
  }, [dispatch, updateLibrary]);

  useEffect(() => {
    const listeners = [
      window.electron.onSignIn(onSignIn),
      window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      }),
      window.electron.onDownloadsUpdated(() => {
        updateLibrary();
      }),
      window.electron.onSignOut(() => clearUserDetails()),
      window.electron.onExtractionProgress((shop, objectId, progress) => {
        dispatch(setExtractionProgress({ shop, objectId, progress }));
      }),
      window.electron.onExtractionComplete(() => {
        dispatch(clearExtraction());
        updateLibrary();
      }),
      window.electron.onExtractionFailed((_shop, _objectId, failure) => {
        dispatch(clearExtraction());
        updateLibrary();

        if (failure?.reason === "unsupported-format") {
          showErrorToast(
            t("extraction_unsupported_format_title", { ns: "downloads" }),
            t("extraction_unsupported_format_description", {
              ns: "downloads",
              format: failure.format,
            })
          );
          return;
        }

        if (failure?.reason === "file-not-found") {
          showErrorToast(
            t("extraction_file_not_found_title", { ns: "downloads" }),
            t("extraction_file_not_found_description", { ns: "downloads" })
          );
          return;
        }

        showErrorToast(
          t("extraction_failed_title", { ns: "downloads" }),
          t("extraction_failed_description", { ns: "downloads" })
        );
      }),
      window.electron.onGameExecutableNotFound(() => {
        showErrorToast(
          t("executable_not_found_title", { ns: "game_details" }),
          t("executable_not_found_description", { ns: "game_details" })
        );
      }),
      window.electron.onDownloadHalted((gameTitle) => {
        updateLibrary();
        showErrorToast(
          t("download_halted_title", { ns: "downloads" }),
          t("download_halted_description", {
            ns: "downloads",
            title: gameTitle,
          })
        );
      }),
      window.electron.onArchiveDeletionPrompt((paths) => {
        setArchivePaths(paths);
        setShowArchiveDeletionModal(true);
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [onSignIn, updateLibrary, clearUserDetails, dispatch, showErrorToast, t]);

  useEffect(() => {
    const asyncScrollAndNotify = async () => {
      if (contentRef.current) contentRef.current.scrollTop = 0;
    };
    asyncScrollAndNotify();
  }, [location.pathname, location.search]);

  useEffect(() => {
    new MutationObserver(() => {
      const modal = document.body.querySelector("[data-hydra-dialog]");

      dispatch(toggleDraggingDisabled(Boolean(modal)));
    }).observe(document.body, {
      attributes: false,
      childList: true,
    });
  }, [dispatch, draggingDisabled]);

  const loadAndApplyTheme = useCallback(async () => {
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code);
    } else {
      removeCustomCss();
    }
  }, []);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onNavigate((path) => {
      navigate(path);
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = globalThis.electron.onOpenAddFriendModal(() => {
      setShowAddFriendModal(true);
    });

    return () => unsubscribe();
  }, []);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onAchievementUnlocked(() => {
      playAudio();
    });

    return () => {
      unsubscribe();
    };
  }, [playAudio]);

  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (window.electron.platform !== "linux") return;

    if (window.electron.isWayland) {
      document.body.classList.add("window-rounded");
    }

    let cancelled = false;

    const applyMaximizeState = (isMaximized: boolean) => {
      if (cancelled) return;
      setIsWindowMaximized(isMaximized);
      document.body.classList.toggle("window-maximized", isMaximized);
    };

    window.electron.isMainWindowMaximized().then(applyMaximizeState);
    const unsubscribe =
      window.electron.onWindowMaximizeChange(applyMaximizeState);

    return () => {
      cancelled = true;
      unsubscribe();
      document.body.classList.remove("window-rounded");
      document.body.classList.remove("window-maximized");
    };
  }, []);

  return (
    <>
      {(window.electron.platform === "win32" ||
        window.electron.platform === "linux") && (
        <div
          className={`title-bar${
            window.electron.platform === "win32" ? " title-bar--windows" : ""
          }`}
        >
          <h4>
            Hydra
            {hasActiveSubscription && (
              <span className="title-bar__cloud-text"> Cloud</span>
            )}
          </h4>

          {window.electron.platform === "linux" && (
            <div className="title-bar__window-controls">
              <button
                type="button"
                className="title-bar__window-control"
                onClick={() => window.electron.minimizeMainWindow()}
                title={t("header:minimize")}
                aria-label={t("header:minimize")}
              >
                <DashIcon size={16} />
              </button>
              <button
                type="button"
                className="title-bar__window-control"
                onClick={() => window.electron.toggleMaximizeMainWindow()}
                title={
                  isWindowMaximized ? t("header:restore") : t("header:maximize")
                }
                aria-label={
                  isWindowMaximized ? t("header:restore") : t("header:maximize")
                }
              >
                {isWindowMaximized ? (
                  <ScreenNormalIcon size={16} />
                ) : (
                  <ScreenFullIcon size={16} />
                )}
              </button>
              <button
                type="button"
                className="title-bar__window-control title-bar__window-control--close"
                onClick={() => window.electron.closeMainWindow()}
                title={t("header:close")}
                aria-label={t("header:close")}
              >
                <XIcon size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        onClose={handleToastClose}
        duration={toast.duration}
      />

      <CloudSubscriptionModal
        visible={isHydraCloudModalVisible}
        onClose={hideHydraCloudModal}
        feature={hydraCloudFeature || undefined}
      />

      <CloudGiftNotificationModal />

      <ArchiveDeletionModal
        visible={showArchiveDeletionModal}
        archivePaths={archivePaths}
        onClose={() => setShowArchiveDeletionModal(false)}
      />

      <AddFriendModal
        visible={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />

      <main>
        <Sidebar />

        <article className="container">
          <Header />

          <section
            ref={contentRef}
            id="scrollableDiv"
            className="container__content"
          >
            <Outlet />
          </section>
        </article>
      </main>

      <BottomPanel />
    </>
  );
}
