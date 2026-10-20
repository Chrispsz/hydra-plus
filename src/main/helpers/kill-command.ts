/**
 * Kill-command builder for close-game (F1 stability fix), extracted
 * verbatim from close-game.ts: on Windows the whole process tree must
 * die, not just the root pid. Pure and platform-injectable so the
 * command shape can be pinned without Electron.
 */
export const buildKillCommand = (
  pid: number,
  platform: NodeJS.Platform = process.platform
): string => {
  if (platform == "win32") {
    // /T terminates the whole process tree: game roots spawned by
    // launchers (Online-Fix, Proton) leave child processes alive
    // otherwise, and the process watcher then reports the game as closed
    // while its children are still writing saves.
    return `taskkill /PID ${pid} /T /F`;
  }

  return `kill -9 ${pid}`;
};
