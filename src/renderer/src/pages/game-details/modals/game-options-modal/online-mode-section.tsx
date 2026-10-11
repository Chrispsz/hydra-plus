import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";

interface OnlineModeSettingsSectionProps {
  onlineFixEnabled: boolean;
  onChangeOnlineFixState: (value: boolean) => Promise<void>;
}

export function OnlineModeSettingsSection({
  onlineFixEnabled,
  onChangeOnlineFixState,
}: Readonly<OnlineModeSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const [steamRunning, setSteamRunning] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    globalThis.window.electron
      .getSteamClientStatus()
      .then((status) => {
        if (!cancelled) setSteamRunning(status.running);
      })
      .catch(() => {
        if (!cancelled) setSteamRunning(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const statusClassName =
    steamRunning == null
      ? "game-options-modal__online-status--unknown"
      : steamRunning
        ? "game-options-modal__online-status--running"
        : "game-options-modal__online-status--stopped";

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

      <div className={`game-options-modal__online-status ${statusClassName}`}>
        <span className="game-options-modal__online-status-dot" />
        <span>
          {steamRunning
            ? t("online_mode_steam_running")
            : steamRunning == null
              ? t("online_mode_steam_unknown")
              : t("online_mode_steam_not_running")}
        </span>
      </div>

      <ul className="game-options-modal__online-notes">
        <li>{t("online_mode_note_steam")}</li>
        <li>{t("online_mode_note_dlls")}</li>
        <li>{t("online_mode_note_version")}</li>
      </ul>
    </div>
  );
}
