import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import type { LibraryGame } from "@types";

interface DangerZoneSectionProps {
  game: LibraryGame;
  deleting: boolean;
  isGameDownloading: boolean;
  onOpenRemoveFromLibrary: () => void;
  onOpenRemoveFiles: () => void;
}

export function DangerZoneSection({
  game,
  deleting,
  isGameDownloading,
  onOpenRemoveFromLibrary,
  onOpenRemoveFiles,
}: Readonly<DangerZoneSectionProps>) {
  const { t } = useTranslation("game_details");

  return (
    <div className="game-options-modal__danger-zone">
      <div className="game-options-modal__header">
        <h2>{t("danger_zone_section_title")}</h2>
        <h4 className="game-options-modal__danger-zone-description">
          {t("danger_zone_section_description")}
        </h4>
      </div>

      <div className="game-options-modal__danger-zone-buttons">
        <Button
          onClick={onOpenRemoveFromLibrary}
          theme="danger"
          disabled={deleting}
        >
          {t("remove_from_library")}
        </Button>

        {game.shop !== "custom" && (
          <Button
            onClick={onOpenRemoveFiles}
            theme="danger"
            disabled={
              isGameDownloading || deleting || !game.download?.downloadPath
            }
          >
            {t("remove_files")}
          </Button>
        )}
      </div>
    </div>
  );
}
