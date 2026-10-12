import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { GameRepack, GameShop } from "@types";

import { ConfirmationModal } from "@renderer/components";

import { useTranslation } from "react-i18next";
import { SkeletonTheme } from "react-loading-skeleton";
import { GameDetailsSkeleton } from "./game-details-skeleton";

import { GameDetailsContent } from "./game-details-content";
import {
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "@renderer/context";
import { useDownload } from "@renderer/hooks";
import { GameOptionsModal, RepacksModal } from "./modals";
import { Downloader, getDownloadersForUri } from "@shared";
import { CloudSaveV2Provider } from "./cloud-save-v2";
import "./game-details.scss";
import "./hero.scss";

export default function GameDetails() {
  const { objectId, shop } = useParams();
  const [searchParams] = useSearchParams();

  const gameTitle = searchParams.get("title");

  const { startDownload, addGameToQueue } = useDownload();

  const { t } = useTranslation("game_details");

  const navigate = useNavigate();

  const selectRepackUri = (repack: GameRepack, downloader: Downloader) =>
    repack.uris.find((uri) => getDownloadersForUri(uri).includes(downloader))!;

  return (
    <GameDetailsContextProvider
      gameTitle={gameTitle!}
      shop={shop! as GameShop}
      objectId={objectId!}
    >
      <GameDetailsContextConsumer>
        {({
          isLoading,
          game,
          gameTitle,
          shop,
          showRepacksModal,
          showGameOptionsModal,
          gameOptionsInitialCategory,
          hasNSFWContentBlocked,
          setHasNSFWContentBlocked,
          updateGame,
          setShowRepacksModal,
          setShowGameOptionsModal,
          setGameOptionsInitialCategory, // ADD THIS
        }) => {
          const handleStartDownload = async (
            repack: GameRepack,
            downloader: Downloader,
            downloadPath: string,
            automaticallyExtract: boolean,
            addToQueueOnly = false,
            fileIndices?: number[],
            selectedFilesSize?: number | null,
            automaticallyDeleteArchiveFiles = false,
            signal?: AbortSignal
          ) => {
            const payload = {
              objectId: objectId!,
              title: gameTitle,
              downloader,
              shop,
              downloadPath,
              uri: selectRepackUri(repack, downloader),
              automaticallyExtract,
              automaticallyDeleteArchiveFiles,
              fileSize: repack.fileSize,
              fileIndices,
              selectedFilesSize,
            };

            const response = addToQueueOnly
              ? await addGameToQueue(payload, signal)
              : await startDownload(payload, signal);

            if (response.ok) {
              await updateGame();
              setShowRepacksModal(false);
              setShowGameOptionsModal(false);
              setGameOptionsInitialCategory("general");
            }

            return response;
          };

          const handleNSFWContentRefuse = () => {
            setHasNSFWContentBlocked(false);
            navigate(-1);
          };

          return (
            <CloudSaveV2Provider objectId={objectId!} shop={shop}>
              <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
                {isLoading ? <GameDetailsSkeleton /> : <GameDetailsContent />}

                <RepacksModal
                  visible={showRepacksModal}
                  startDownload={handleStartDownload}
                  onClose={() => setShowRepacksModal(false)}
                />

                <ConfirmationModal
                  visible={hasNSFWContentBlocked}
                  onClose={handleNSFWContentRefuse}
                  title={t("nsfw_content_title")}
                  descriptionText={t("nsfw_content_description", {
                    title: gameTitle,
                  })}
                  confirmButtonLabel={t("allow_nsfw_content")}
                  cancelButtonLabel={t("refuse_nsfw_content")}
                  onConfirm={() => setHasNSFWContentBlocked(false)}
                  clickOutsideToClose={false}
                />

                {game && (
                  <GameOptionsModal
                    visible={showGameOptionsModal}
                    game={game}
                    onClose={() => {
                      setShowGameOptionsModal(false);
                      setGameOptionsInitialCategory("general");
                    }}
                    initialCategory={gameOptionsInitialCategory}
                    onNavigateHome={() => navigate("/")}
                  />
                )}
              </SkeletonTheme>
            </CloudSaveV2Provider>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
