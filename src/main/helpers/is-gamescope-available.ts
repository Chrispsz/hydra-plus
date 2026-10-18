import { spawnSync } from "node:child_process";

export const isGamescopeAvailable = (): boolean => {
  if (process.platform !== "linux") {
    return false;
  }

  // `command -v` only checks PATH resolution: executing `gamescope --help`
  // could require a working compositor connection on some builds.
  const commandCheck = spawnSync("/bin/sh", ["-c", "command -v gamescope"], {
    stdio: "ignore",
    shell: false,
  });

  return !commandCheck.error && commandCheck.status === 0;
};
