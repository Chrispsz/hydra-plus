import { registerEvent } from "../register-event";
import { isSteamClientRunning } from "@main/services/online-fix";

registerEvent("getSteamClientStatus", async () => {
  return { running: await isSteamClientRunning() };
});
