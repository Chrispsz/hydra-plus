import { registerEvent } from "./register-event";
import { DebugConsole } from "@main/services";

registerEvent("debug-console:buffer", async () => DebugConsole.getBuffer());

registerEvent("debug-console:clear", async () => {
  DebugConsole.clear();
  return true;
});

registerEvent("debug-console:export", async () => DebugConsole.exportLog());

registerEvent(
  "debug-console:env-dump",
  async () => await DebugConsole.collectEnvironmentSnapshot()
);

registerEvent("debug-console:close", async () => {
  DebugConsole.closeWindow();
  return true;
});

registerEvent("debug-console:open", async () => {
  DebugConsole.openWindow();
  return true;
});
