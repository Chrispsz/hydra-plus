import { useTranslation } from "react-i18next";
import { type ReactNode } from "react";

import { Button } from "@renderer/components";
import type { LibraryGame } from "@types";

// Labels that don't fit their button end in "…"; the button's title shows
// the full text on hover.
function ButtonLabel({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="game-options-modal__button-label">{children}</span>;
}

interface DownloadsSettingsSectionProps {
  game: LibraryGame;
  deleting: boolean;
  isGameDownloading: boolean;
  repacksLength: number;
  onOpenRepacks: () => void;
  onOpenDownloadFolder: () => Promise<void>;
}

export function DownloadsSettingsSection({
  game,
  deleting,
  isGameDownloading,
  repacksLength,
  onOpenRepacks,
  onOpenDownloadFolder,
}: Readonly<DownloadsSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  if (game.shop === "custom") {
    return (
      <p className="game-options-modal__category-note">
        {t("settings_not_available_for_custom_games")}
      </p>
    );
  }

  return (
    <div className="game-options-modal__downloads">
      <div className="game-options-modal__header">
        <h2>{t("downloads_section_title")}</h2>
        <h4 className="game-options-modal__header-description">
          {t("downloads_section_description")}
        </h4>
      </div>

      <div className="game-options-modal__row">
        <Button
          onClick={onOpenRepacks}
          theme="outline"
          disabled={deleting || isGameDownloading || !repacksLength}
          title={t("open_download_options")}
        >
          <ButtonLabel>{t("open_download_options")}</ButtonLabel>
        </Button>
        {game.download?.downloadPath && (
          <Button
            onClick={onOpenDownloadFolder}
            theme="outline"
            disabled={deleting}
            title={t("open_download_location")}
          >
            <ButtonLabel>{t("open_download_location")}</ButtonLabel>
          </Button>
        )}
      </div>
    </div>
  );
}
