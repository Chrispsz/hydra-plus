import { registerEvent } from "../register-event";
import { shell } from "electron";
import fs from "node:fs";
import { logsPath } from "@main/constants";

const openLogsFolder = async () => {
  fs.mkdirSync(logsPath, { recursive: true });
  await shell.openPath(logsPath);
};

registerEvent("openLogsFolder", openLogsFolder);
