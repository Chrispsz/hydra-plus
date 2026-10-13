import { useContext } from "react";

import {
  gameDetailsContext,
  GameDetailsContextProvider,
} from "@renderer/context/game-details/game-details.context";
import { CloudSaveV2Provider } from "@renderer/pages/game-details/cloud-save-v2";
import { GameOptionsModal } from "@renderer/pages/game-details/modals";
import type { GameSettingsCategoryId } from "@renderer/pages/game-details/modals/game-options-modal/types";
import type { LibraryGame } from "@types";

export interface GameOptionsModalRootProps {
  target: {
    game: LibraryGame;
    initialCategory: GameSettingsCategoryId;
  };
  onClose: () => void;
  onNavigateHome: () => void;
}

/**
 * The full game options modal subtree (details context + cloud save v2 +
 * every settings modal). Lives in its own lazily imported module so the
 * app shell never pays for it at startup; it is only mounted while the
 * modal is open, which also masks the chunk fetch.
 */
export default function GameOptionsModalRoot({
  target,
  onClose,
  onNavigateHome,
}: Readonly<GameOptionsModalRootProps>) {
  return (
    <GameDetailsContextProvider
      objectId={target.game.objectId}
      shop={target.game.shop}
      gameTitle={target.game.title}
      syncHeaderTitle={false}
    >
      <GameOptionsModalHost
        target={target}
        onClose={onClose}
        onNavigateHome={onNavigateHome}
      />
    </GameDetailsContextProvider>
  );
}

function GameOptionsModalHost({
  target,
  onClose,
  onNavigateHome,
}: Readonly<GameOptionsModalRootProps>) {
  const { game } = useContext(gameDetailsContext);

  if (!game) return null;

  return (
    <CloudSaveV2Provider
      objectId={target.game.objectId}
      shop={target.game.shop}
    >
      <GameOptionsModal
        visible
        game={game}
        initialCategory={target.initialCategory}
        onClose={onClose}
        onNavigateHome={onNavigateHome}
      />
    </CloudSaveV2Provider>
  );
}
