import { UserGame } from "@types";
import { useNavigate } from "react-router-dom";
import { useCallback, useContext } from "react";
import { buildGameDetailsPath } from "@renderer/helpers";
import { userProfileContext } from "@renderer/context";
import { ClockIcon, AlertFillIcon } from "@primer/octicons-react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { Tooltip } from "react-tooltip";
import { useTranslation } from "react-i18next";
import { GameVisibilityBadge } from "@renderer/components/game-visibility-badge/game-visibility-badge";
import { VerticalCoverCard } from "@renderer/components";
import "./user-library-game-card.scss";

interface UserLibraryGameCardProps {
  game: UserGame;
  statIndex: number;
  onContextMenu: (game: UserGame, position: { x: number; y: number }) => void;
}

export function UserLibraryGameCard({
  game,
  onContextMenu,
}: UserLibraryGameCardProps) {
  const { isMe } = useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const navigate = useNavigate();

  const coverImageUrl = game.customLibraryImageUrl ?? game.coverImageUrl;

  const buildUserGameDetailsPath = (game: UserGame) =>
    buildGameDetailsPath({
      ...game,
      objectId: game.objectId,
    });

  const formatPlayTime = useCallback(
    (playTimeInSeconds = 0, isShort = false) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t(isShort ? "amount_minutes_short" : "amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      const hoursKey = isShort ? "amount_hours_short" : "amount_hours";
      const hoursAmount = isShort ? Math.floor(hours) : hours.toFixed(0);

      return t(hoursKey, { amount: hoursAmount });
    },
    [t]
  );

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!isMe) return;

    event.preventDefault();
    event.stopPropagation();

    onContextMenu(game, { x: event.clientX, y: event.clientY });
  };

  return (
    <>
      <li className="user-library-game__wrapper">
        <VerticalCoverCard
          gameTitle={game.title}
          coverImageUrls={[coverImageUrl]}
          useClassicsLayout={
            game.shop === "launchbox" && !game.customLibraryImageUrl
          }
          showTitleTooltip={false}
          onClick={() => navigate(buildUserGameDetailsPath(game))}
          onContextMenu={handleContextMenu}
        >
          <div
            className={`user-library-game__overlay user-library-game__overlay--no-fade${game.shop === "launchbox" && !game.customLibraryImageUrl ? " user-library-game__overlay--classics" : ""}`}
          >
            <div className="user-library-game__top-section">
              <div className="user-library-game__top-left">
                <GameVisibilityBadge
                  isHiddenFromOthers={game.isHiddenFromOthers}
                  isConcealed={game.isConcealed}
                />
                <div
                  className="user-library-game__playtime"
                  data-tooltip-place="top"
                  data-tooltip-content={
                    game.hasManuallyUpdatedPlaytime
                      ? t("manual_playtime_tooltip")
                      : undefined
                  }
                  data-tooltip-id={game.objectId}
                >
                  {game.hasManuallyUpdatedPlaytime ? (
                    <AlertFillIcon
                      size={11}
                      className="user-library-game__manual-playtime"
                    />
                  ) : (
                    <ClockIcon size={11} />
                  )}
                  <span className="user-library-game__playtime-long">
                    {formatPlayTime(game.playTimeInSeconds)}
                  </span>
                  <span className="user-library-game__playtime-short">
                    {formatPlayTime(game.playTimeInSeconds, true)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </VerticalCoverCard>
      </li>
      <Tooltip
        id={game.objectId}
        style={{
          zIndex: 9999,
        }}
        openOnClick={false}
      />
    </>
  );
}
