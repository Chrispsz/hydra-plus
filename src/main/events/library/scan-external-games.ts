import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import type { ExternalGameCandidate, Game } from "@types";

import {
  createExternalGameScanDeps,
  scanExternalGames,
} from "@main/services/external-games/scan-external-games";

const getLibraryGames = async (): Promise<Game[]> =>
  (await gamesSublevel.values().all()).filter(
    (game) => game.isDeleted === false
  );

const scanExternalGamesEvent = async (): Promise<ExternalGameCandidate[]> =>
  scanExternalGames(createExternalGameScanDeps({ getLibraryGames }));

registerEvent("scanExternalGames", scanExternalGamesEvent);
