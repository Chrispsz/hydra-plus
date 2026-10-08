import { registerEvent } from "../register-event";
import { Umu } from "@main/services";
import { db, levelKeys } from "@main/level";
import type { CompatibilityDiagnostic, UserPreferences } from "@types";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const isWineAvailable = () => {
  try {
    const result = spawnSync("wine", ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      shell: false,
      timeout: 5_000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
};

const getCompatibilityDiagnostics =
  async (): Promise<CompatibilityDiagnostic> => {
    const umuRunPath = Umu.getBinaryPath();
    const umuLogPath = Umu.getLogPath();
    const pythonPath = Umu.getCompatiblePythonPath();

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const defaultProtonPath = userPreferences?.defaultProtonPath ?? null;

    return {
      umuRunPath,
      umuRunFound: fs.existsSync(umuRunPath),
      pythonPath,
      defaultProtonPath,
      defaultProtonValid: Boolean(
        defaultProtonPath && Umu.isValidProtonPath(defaultProtonPath)
      ),
      wineAvailable: process.platform === "linux" ? isWineAvailable() : false,
      umuLogPath,
      umuLogExists: fs.existsSync(umuLogPath),
      umuLogTail: Umu.readLogTail(60),
    };
  };

registerEvent("getCompatibilityDiagnostics", getCompatibilityDiagnostics);
