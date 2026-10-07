import { registerEvent } from "../register-event";
import { addGameOutsideLibrary } from "./scan-installed-games";
import { WindowManager } from "@main/services";

const addScannedGames = async (
  _event: Electron.IpcMainInvokeEvent,
  picks: { objectId: string; executablePath: string }[]
) => {
  const addedGames: NonNullable<
    Awaited<ReturnType<typeof addGameOutsideLibrary>>
  >[] = [];

  for (const { objectId, executablePath } of picks) {
    const addedGame = await addGameOutsideLibrary(
      objectId,
      executablePath
    ).catch(() => null);

    if (addedGame) addedGames.push(addedGame);
  }

  if (addedGames.length > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return addedGames;
};

registerEvent("addScannedGames", addScannedGames);
