import { useAppSelector } from "@renderer/hooks";
import { useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { PersonIcon, SignOutIcon } from "@primer/octicons-react";
import "./sidebar-profile.scss";

export function SidebarProfile() {
  const { t } = useTranslation("sidebar");

  const { gameRunning } = useAppSelector((state) => state.gameRunning);
  const { userDetails, signOut } = useUserDetails();

  if (gameRunning) {
    return (
      <div className="sidebar-profile">
        <div className="sidebar-profile__game-running">
          <div className="sidebar-profile__game-running-information">
            <p className="sidebar-profile__game-running-title">
              {gameRunning.title}
            </p>

            <div className="sidebar-profile__game-running-label">
              <small>{t("game_running")}</small>
            </div>
          </div>

          {gameRunning.iconUrl ? (
            <img
              className="sidebar-profile__game-running-icon"
              alt={gameRunning.title}
              width={24}
              src={gameRunning.iconUrl}
            />
          ) : (
            <SteamLogo />
          )}
        </div>
      </div>
    );
  }

  if (!userDetails) {
    return (
      <div className="sidebar-profile">
        <button
          type="button"
          className="sidebar-profile__sign-in"
          onClick={() => window.electron.openAuthWindow()}
          title={t("sign_in_hint")}
        >
          <PersonIcon size={16} />
          <span>{t("sign_in")}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar-profile">
      <div className="sidebar-profile__account" title={t("sign_out")}>
        {userDetails.profileImageUrl ? (
          <img
            className="sidebar-profile__account-avatar"
            alt={userDetails.displayName}
            width={24}
            height={24}
            src={userDetails.profileImageUrl}
          />
        ) : (
          <PersonIcon size={16} />
        )}

        <span className="sidebar-profile__account-name">
          {userDetails.displayName}
        </span>

        <button
          type="button"
          className="sidebar-profile__account-sign-out"
          onClick={() => void signOut()}
          aria-label={t("sign_out")}
        >
          <SignOutIcon size={14} />
        </button>
      </div>
    </div>
  );
}
