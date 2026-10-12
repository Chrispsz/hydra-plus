import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import type { GameShop } from "@types";

interface OnlineModeSettingsSectionProps {
  shop: GameShop;
  objectId: string;
  onlineFixEnabled: boolean;
  onChangeOnlineFixState: (value: boolean) => Promise<void>;
}

export function OnlineModeSettingsSection({
  shop,
  objectId,
  onlineFixEnabled,
  onChangeOnlineFixState,
}: Readonly<OnlineModeSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const [steamRunning, setSteamRunning] = useState<boolean | null>(null);
  const [onlineFixDetected, setOnlineFixDetected] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    globalThis.window.electron
      .getOnlineFixStatus(shop, objectId)
      .then((status) => {
        if (cancelled) return;
        setSteamRunning(status.steamRunning);
        setOnlineFixDetected(status.onlineFixDetected);
      })
      .catch(() => {
        if (!cancelled) setSteamRunning(null);
      });

    return () => {
      cancelled = true;
    };
  }, [shop, objectId]);

  const statusClassName = (value: boolean | null, inverted = false) => {
    if (value == null) return "game-options-modal__online-status--unknown";
    const positive = inverted ? !value : value;
    return positive
      ? "game-options-modal__online-status--running"
      : "game-options-modal__online-status--stopped";
  };

  return (
    <div className="game-options-modal__section">
      <div className="game-options-modal__header">
        <h2>{t("online_mode_title")}</h2>
        <h4 className="game-options-modal__header-description">
          {t("online_mode_description")}
        </h4>
      </div>

      <div className="game-options-modal__online-mode-toggle">
        <CheckboxField
          label={
            <span className="game-options-modal__online-mode-label">
              <span>{t("online_mode_enable")}</span>
            </span>
          }
          checked={onlineFixEnabled}
          onChange={(event) => onChangeOnlineFixState(event.target.checked)}
        />
      </div>

      <div
        className={`game-options-modal__online-status ${statusClassName(steamRunning)}`}
      >
        <span className="game-options-modal__online-status-dot" />
        <span>
          {steamRunning
            ? t("online_mode_steam_running")
            : steamRunning == null
              ? t("online_mode_steam_unknown")
              : t("online_mode_steam_not_running")}
        </span>
      </div>

      {onlineFixEnabled && (
        <div
          className={`game-options-modal__online-status ${statusClassName(onlineFixDetected)}`}
        >
          <span className="game-options-modal__online-status-dot" />
          <span>
            {onlineFixDetected
              ? t("online_mode_fix_detected")
              : onlineFixDetected == null
                ? t("online_mode_fix_unknown")
                : t("online_mode_fix_missing")}
          </span>
        </div>
      )}

      <ul className="game-options-modal__online-notes">
        <li>{t("online_mode_note_steam")}</li>
        <li>{t("online_mode_note_dlls")}</li>
        <li>{t("online_mode_note_version")}</li>
      </ul>
    </div>
  );
}
