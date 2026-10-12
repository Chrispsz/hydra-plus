import { useNavigate } from "react-router-dom";
import { BellIcon } from "@primer/octicons-react";
import { useAppSelector } from "@renderer/hooks";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { logger } from "@renderer/logger";
import "./sidebar-profile.scss";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const [notificationCount, setNotificationCount] = useState(0);

  const fetchNotificationCount = useCallback(async () => {
    try {
      const localCount = await window.electron.getLocalNotificationsCount();
      setNotificationCount(localCount);
    } catch (error) {
      logger.error("Failed to fetch local notification count", error);
    }
  }, []);

  useEffect(() => {
    fetchNotificationCount();

    const unsubscribe = window.electron.onLocalNotificationCreated(() => {
      fetchNotificationCount();
    });

    return () => unsubscribe();
  }, [fetchNotificationCount]);

  const gameRunningDetails = () => {
    if (!gameRunning) return null;

    if (gameRunning.iconUrl) {
      return (
        <img
          className="sidebar-profile__game-running-icon"
          alt={gameRunning.title}
          width={24}
          src={gameRunning.iconUrl}
        />
      );
    }

    return <SteamLogo />;
  };

  return (
    <div className="sidebar-profile">
      <button
        type="button"
        className="sidebar-profile__button"
        onClick={() => navigate("/notifications")}
      >
        <div className="sidebar-profile__button-content">
          <div className="sidebar-profile__button-information">
            <p className="sidebar-profile__button-title">
              {gameRunning ? gameRunning.title : t("notifications")}
            </p>

            {gameRunning && (
              <div className="sidebar-profile__button-game-running-title">
                <small>{t("game_running")}</small>
              </div>
            )}
          </div>

          {gameRunningDetails()}

          <div className="sidebar-profile__notification-badge">
            <BellIcon size={16} />
            {notificationCount > 0 && (
              <small className="sidebar-profile__dropdown-badge">
                {notificationCount > 99 ? "99+" : notificationCount}
              </small>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}
