import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import type { LibraryGame } from "@types";
import type { GameSettingsCategoryId } from "@renderer/pages/game-details/modals/game-options-modal/types";

const GameOptionsModalRoot = lazy(() => import("./game-options-modal-root"));

export interface GameOptionsModalContext {
  openGameOptionsModal: (
    game: LibraryGame,
    initialCategory?: GameSettingsCategoryId
  ) => void;
}

export const gameOptionsModalContext = createContext<GameOptionsModalContext>({
  openGameOptionsModal: () => {},
});

const { Provider } = gameOptionsModalContext;

export const useGameOptionsModal = () => useContext(gameOptionsModalContext);

export interface GameOptionsModalProviderProps {
  children: React.ReactNode;
}

interface GameOptionsModalTarget {
  game: LibraryGame;
  initialCategory: GameSettingsCategoryId;
}

export function GameOptionsModalProvider({
  children,
}: Readonly<GameOptionsModalProviderProps>) {
  const navigate = useNavigate();
  const [target, setTarget] = useState<GameOptionsModalTarget | null>(null);

  const openGameOptionsModal = useCallback(
    (game: LibraryGame, initialCategory: GameSettingsCategoryId = "general") =>
      setTarget({ game, initialCategory }),
    []
  );

  const closeGameOptionsModal = useCallback(() => setTarget(null), []);

  const value = useMemo(
    () => ({ openGameOptionsModal }),
    [openGameOptionsModal]
  );

  return (
    <Provider value={value}>
      {children}

      {target && (
        <Suspense fallback={null}>
          <GameOptionsModalRoot
            target={target}
            onClose={closeGameOptionsModal}
            onNavigateHome={() => {
              closeGameOptionsModal();
              navigate("/");
            }}
          />
        </Suspense>
      )}
    </Provider>
  );
}
