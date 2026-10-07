import { useCallback, useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat, useUserDetails } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { ClockIcon } from "@primer/octicons-react";
import { Award } from "lucide-react";
import "./user-stats-box.scss";

export function UserStatsBox() {
  const { userStats, isMe, userProfile } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const formatPlayTime = useCallback(
    (playTimeInSeconds: number) => {
      const seconds = playTimeInSeconds;
      const minutes = seconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  if (!userStats) return null;

  const karma = isMe ? userDetails?.karma : userProfile?.karma;
  const hasKarma = karma !== undefined && karma !== null;

  return (
    <div className="user-stats__box">
      <ul className="user-stats__list">
        <li className="user-stats__list-item">
          <h3 className="user-stats__list-title">{t("total_play_time")}</h3>
          <div className="user-stats__stats-row">
            <p className="user-stats__list-description">
              <ClockIcon />
              {formatPlayTime(userStats.totalPlayTimeInSeconds.value)}
            </p>
            <p title={t("ranking_updated_weekly")}>
              {t("top_percentile", {
                percentile: userStats.totalPlayTimeInSeconds.topPercentile,
              })}
            </p>
          </div>
        </li>

        {hasKarma && karma !== undefined && karma !== null && (
          <li className="user-stats__list-item user-stats__list-item--karma">
            <h3 className="user-stats__list-title">{t("karma")}</h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <Award size={20} /> {numberFormatter.format(karma)}{" "}
                {t("karma_count")}
              </p>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
