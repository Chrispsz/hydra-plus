import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";

/**
 * Signs the user out of their Hydra account: wipes the local session
 * keys and notifies the app windows. The library/downloads stay
 * untouched — the lean launcher is local-first.
 */
const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  await db
    .batch([
      { type: "del", key: levelKeys.auth },
      { type: "del", key: levelKeys.user },
    ])
    .catch(() => {});

  await HydraApi.handleSignOut();
};

registerEvent("signOut", signOut);
