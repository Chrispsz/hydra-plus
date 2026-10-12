import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

registerEvent("getMe", async () => {
  return HydraApi.getMe();
});
