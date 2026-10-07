import { useCallback, useMemo } from "react";
import {
  XIcon,
  PersonIcon,
  ClockIcon,
  StarFillIcon,
  HeartFillIcon,
  CommentDiscussionIcon,
  GiftIcon,
} from "@primer/octicons-react";
import retroAchievementsLogo from "@renderer/assets/icons/retroachievements.png";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDate } from "@renderer/hooks";
import cn from "classnames";
import { buildSouvenirNotificationTarget } from "@shared";

import type { Notification, Badge } from "@types";
import { openCloudGiftModal } from "../shared-modals/cloud-gift-modal.events";
import "./notification-item.scss";

const parseNotificationUrl = (notificationUrl: string): string => {
  const url = new URL(notificationUrl, "http://localhost");
  const userId = url.searchParams.get("userId");
  const badgeName = url.searchParams.get("name");
  const gameTitle = url.searchParams.get("title");
  const showReviews = url.searchParams.get("reviews");
  const reviewId = url.searchParams.get("reviewId");

  if (url.pathname === "/profile" && userId) {
    return `/profile/${userId}`;
  }

  if (url.pathname === "/badges" && badgeName) {
    return `/badges/${badgeName}`;
  }

  if (
    url.pathname === "/profile/integrations/retroachievements" ||
    url.pathname === "/profile/integrations/steam"
  ) {
    return "/settings?tab=integrations";
  }

  if (url.pathname.startsWith("/game/")) {
    const params = new URLSearchParams();
    if (gameTitle) params.set("title", gameTitle);
    if (showReviews) params.set("reviews", showReviews);
    if (reviewId) params.set("reviewId", reviewId);
    const queryString = params.toString();
    return queryString ? `${url.pathname}?${queryString}` : url.pathname;
  }

  return notificationUrl;
};

const getNotificationTarget = (notification: Notification) => {
  if (!notification.url) return null;

  const target = parseNotificationUrl(notification.url);
  if (notification.type !== "SOUVENIR_LIKE") return target;

  return buildSouvenirNotificationTarget(target, notification.variables);
};

interface NotificationItemProps {
  notification: Notification;
  badges: Badge[];
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
}

export function NotificationItem({
  notification,
  badges,
  onDismiss,
  onMarkAsRead,
}: Readonly<NotificationItemProps>) {
  const { t } = useTranslation("notifications_page");
  const { formatDistance } = useDate();
  const navigate = useNavigate();

  const badge = useMemo(() => {
    if (notification.type !== "BADGE_RECEIVED") return null;
    return badges.find((b) => b.name === notification.variables.badgeName);
  }, [notification, badges]);

  const handleClick = useCallback(() => {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }

    if (
      notification.type === "CLOUD_GIFT_RECEIVED" &&
      notification.variables.giftId
    ) {
      openCloudGiftModal(notification);
      return;
    }

    const target = getNotificationTarget(notification);
    if (target) navigate(target);
  }, [notification, onMarkAsRead, navigate]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(notification.id);
    },
    [notification.id, onDismiss]
  );

  const getNotificationContent = () => {
    switch (notification.type) {
      case "BADGE_RECEIVED":
        return {
          title: t("badge_received_title"),
          description: badge?.description || notification.variables.badgeName,
        };
      case "REVIEW_UPVOTE":
        return {
          title: t("review_upvote_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("review_upvote_description", {
            count: Number.parseInt(
              notification.variables.upvoteCount || "1",
              10
            ),
          }),
        };
      case "REVIEW_ANSWER":
        return {
          title: t("review_answer_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("review_answer_description", {
            displayName: notification.variables.answerAuthorDisplayName,
          }),
        };
      case "REVIEW_ANSWER_UPVOTE":
        return {
          title: t("review_answer_upvote_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("review_answer_upvote_description", {
            count: Number.parseInt(
              notification.variables.upvoteCount || "1",
              10
            ),
          }),
        };
      case "SOUVENIR_LIKE":
        return {
          title: t("souvenir_like_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("souvenir_like_description", {
            count: Number(notification.variables.likeCount ?? 1),
          }),
        };
      case "RETROACHIEVEMENTS_CREDENTIALS_RESTORED":
        return {
          title: t("retroachievements_credentials_restored_title"),
          description: t("retroachievements_credentials_restored_description"),
        };
      case "RETROACHIEVEMENTS_CREDENTIALS_INVALID":
        return {
          title: t("retroachievements_credentials_invalid_title"),
          description: t("retroachievements_credentials_invalid_description"),
        };
      case "RETROACHIEVEMENTS_SYNC_FAILED":
        return {
          title: t("retroachievements_sync_failed_title"),
          description: t("retroachievements_sync_failed_description", {
            gameTitle: notification.variables.gameTitle,
          }),
        };
      case "CLOUD_GIFT_RECEIVED": {
        const durationMonths = Number(notification.variables.durationMonths);

        return {
          title: Number.isFinite(durationMonths)
            ? t("cloud_gift_received_title", { count: durationMonths })
            : t("cloud_gift_received_title"),
          description: t("cloud_gift_received_description", {
            displayName: notification.variables.buyerDisplayName,
          }),
        };
      }
      default:
        return {
          title: t("notification"),
          description: "",
        };
    }
  };

  const content = getNotificationContent();
  const isBadge = notification.type === "BADGE_RECEIVED";
  const isReviewUpvote = notification.type === "REVIEW_UPVOTE";
  const isReviewAnswer = notification.type === "REVIEW_ANSWER";
  const isReviewAnswerUpvote = notification.type === "REVIEW_ANSWER_UPVOTE";
  const isReview = isReviewUpvote || isReviewAnswer || isReviewAnswerUpvote;
  const isSouvenirLike = notification.type === "SOUVENIR_LIKE";

  const isRetroAchievements =
    notification.type === "RETROACHIEVEMENTS_CREDENTIALS_RESTORED" ||
    notification.type === "RETROACHIEVEMENTS_CREDENTIALS_INVALID" ||
    notification.type === "RETROACHIEVEMENTS_SYNC_FAILED";

  const getIcon = () => {
    if (notification.pictureUrl) {
      return <img src={notification.pictureUrl} alt="" />;
    }
    if (isRetroAchievements) {
      return <img src={retroAchievementsLogo} alt="" />;
    }
    if (isReviewUpvote || isReviewAnswerUpvote) {
      return <StarFillIcon size={24} />;
    }
    if (isReviewAnswer) {
      return <CommentDiscussionIcon size={24} />;
    }
    if (notification.type === "CLOUD_GIFT_RECEIVED") {
      return <GiftIcon size={24} />;
    }
    if (isSouvenirLike) {
      return <HeartFillIcon size={24} />;
    }
    return <PersonIcon size={24} />;
  };

  return (
    <button
      type="button"
      className={cn("notification-item", {
        "notification-item--unread": !notification.isRead,
      })}
      onClick={handleClick}
    >
      <div
        className={cn("notification-item__picture", {
          "notification-item__badge-picture": isBadge,
          "notification-item__review-picture": isReview,
          "notification-item__ra-picture": isRetroAchievements,
        })}
      >
        {getIcon()}
      </div>

      <div className="notification-item__content">
        <span className="notification-item__title">{content.title}</span>
        <span className="notification-item__description">
          {content.description}
        </span>
        <span className="notification-item__time">
          <ClockIcon size={12} />
          {formatDistance(new Date(notification.createdAt), new Date())}
        </span>
      </div>

      <button
        type="button"
        className="notification-item__dismiss"
        onClick={handleDismiss}
        title={t("dismiss")}
      >
        <XIcon size={16} />
      </button>
    </button>
  );
}
