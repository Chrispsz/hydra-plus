import { useCallback, useEffect, useMemo, useState } from "react";
import { BellIcon, XIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { useAppDispatch } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { logger } from "@renderer/logger";

import { LocalNotificationItem } from "./local-notification-item";
import type { LocalNotification } from "@types";
import "./notifications.scss";

type NotificationFilter = "all" | "unread";

export default function Notifications() {
  const { t } = useTranslation("notifications_page");
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(setHeaderTitle(t("title")));
  }, [dispatch, t]);

  const [notifications, setNotifications] = useState<LocalNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");

  const fetchNotifications = useCallback(async () => {
    try {
      const localNotifications = await window.electron.getLocalNotifications();
      setNotifications(localNotifications);
    } catch (error) {
      logger.error("Failed to fetch local notifications", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    const unsubscribe =
      window.electron.onLocalNotificationCreated(fetchNotifications);

    return () => unsubscribe();
  }, [fetchNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );

  const visibleNotifications = useMemo(
    () =>
      filter === "unread"
        ? notifications.filter((notification) => !notification.isRead)
        : notifications,
    [filter, notifications]
  );

  const handleMarkAsRead = useCallback(async (id: string) => {
    try {
      await window.electron.markLocalNotificationRead(id);
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === id
            ? { ...notification, isRead: true }
            : notification
        )
      );
    } catch (error) {
      logger.error("Failed to mark notification as read", error);
    }
  }, []);

  const handleDismiss = useCallback(async (id: string) => {
    try {
      await window.electron.deleteLocalNotification(id);
      setNotifications((current) =>
        current.filter((notification) => notification.id !== id)
      );
    } catch (error) {
      logger.error("Failed to dismiss notification", error);
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    setIsClearing(true);
    try {
      await window.electron.clearAllLocalNotifications();
      setNotifications([]);
    } catch (error) {
      logger.error("Failed to clear notifications", error);
    } finally {
      setIsClearing(false);
    }
  }, []);

  return (
    <div className="notifications">
      <div className="notifications__header">
        <div className="notifications__filters">
          <button
            type="button"
            className={`notifications__filter${filter === "all" ? " notifications__filter--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            {t("filter_all")}
          </button>
          <button
            type="button"
            className={`notifications__filter${filter === "unread" ? " notifications__filter--active" : ""}`}
            onClick={() => setFilter("unread")}
          >
            {t("filter_unread")}
            {unreadCount > 0 && (
              <small className="notifications__filter-badge">
                {unreadCount > 99 ? "99+" : unreadCount}
              </small>
            )}
          </button>
        </div>

        {notifications.length > 0 && (
          <Button theme="dark" onClick={handleClearAll} disabled={isClearing}>
            <XIcon size={14} />
            {t("clear_all")}
          </Button>
        )}
      </div>

      <div className="notifications__list">
        {isLoading ? (
          <div className="notifications__empty-state">
            <BellIcon size={42} />
            <p>{t("loading")}</p>
          </div>
        ) : visibleNotifications.length === 0 ? (
          <div className="notifications__empty-state">
            <BellIcon size={42} />
            <p>
              {filter === "unread"
                ? t("no_unread_notifications")
                : t("no_notifications")}
            </p>
          </div>
        ) : (
          visibleNotifications.map((notification) => (
            <LocalNotificationItem
              key={notification.id}
              notification={notification}
              onDismiss={(id) => void handleDismiss(id)}
              onMarkAsRead={(id) => void handleMarkAsRead(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
