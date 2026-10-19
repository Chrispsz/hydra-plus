import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDesktopEntryCandidates,
  type DesktopEntryScanFilesystem,
} from "./desktop-entries.js";

const homeDir = "/home/tester";
const localApplications = "/home/tester/.local/share/applications";

const createFakeFilesystem = (
  files: Record<string, string>
): {
  fs: DesktopEntryScanFilesystem;
  existingPaths: Set<string>;
} => {
  const existingPaths = new Set<string>([localApplications]);
  return {
    fs: {
      existsSync: (targetPath) =>
        existingPaths.has(targetPath) ||
        targetPath in files ||
        targetPath === localApplications,
      readFileSync: (targetPath) => {
        const contents = files[targetPath];
        if (contents === undefined) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return contents;
      },
      readdirSync: (dirPath) => {
        if (dirPath !== localApplications) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return Object.keys(files)
          .filter((filePath) => filePath.startsWith(`${dirPath}/`))
          .map((filePath) => filePath.slice(dirPath.length + 1));
      },
      statSync: () => ({ isDirectory: () => true }),
    },
    existingPaths,
  };
};

const desktopEntry = (fields: Record<string, string>): string =>
  [
    "[Desktop Entry]",
    ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
  ].join("\n");

describe("linux desktop entry scanner", () => {
  it("keeps applications and drops other entry types", () => {
    const { fs } = createFakeFilesystem({
      [`${localApplications}/game.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Celeste",
        Exec: "/opt/celeste/celeste",
      }),
      [`${localApplications}/link.desktop`]: desktopEntry({
        Type: "Link",
        Name: "Not An App",
        Exec: "/opt/nope/nope",
      }),
    });

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });

    assert.deepEqual(
      candidates.map((candidate) => candidate.title),
      ["Celeste"]
    );
  });

  it("skips terminal and hidden entries", () => {
    const { fs } = createFakeFilesystem({
      [`${localApplications}/plain.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Plain",
        Exec: "/usr/bin/plain",
      }),
      [`${localApplications}/terminal.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Terminal App",
        Terminal: "true",
        Exec: "/usr/bin/htop",
      }),
      [`${localApplications}/hidden.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Hidden App",
        NoDisplay: "true",
        Exec: "/usr/bin/hidden",
      }),
    });

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });

    assert.deepEqual(
      candidates.map((candidate) => candidate.title),
      ["Plain"]
    );
  });

  it("strips field codes and quoting from Exec and requires an existing absolute path", () => {
    const { fs, existingPaths } = createFakeFilesystem({
      [`${localApplications}/quoted.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Quoted Game",
        Exec: '"/opt/games/quoted/quoted game" %f',
      }),
      [`${localApplications}/missing.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Missing Game",
        Exec: "/opt/games/never-installed/game %u",
      }),
      [`${localApplications}/relative.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Relative Game",
        Exec: "play-game",
      }),
    });
    existingPaths.add("/opt/games/quoted/quoted game");

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });
    const byTitle = new Map(
      candidates.map((candidate) => [candidate.title, candidate])
    );

    assert.equal(
      byTitle.get("Quoted Game")?.executablePath,
      "/opt/games/quoted/quoted game"
    );
    assert.equal(byTitle.get("Missing Game")?.executablePath, null);
    assert.equal(byTitle.get("Relative Game")?.executablePath, null);
  });

  it("resolves flatpak run commands to the exports bin when it exists", () => {
    const { fs, existingPaths } = createFakeFilesystem({
      [`${localApplications}/flatpak-user.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Flatpak User Game",
        Exec: "flatpak run --branch=stable com.example.UserGame",
      }),
      [`${localApplications}/flatpak-system.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Flatpak System Game",
        Exec: "flatpak run com.example.SystemGame",
      }),
      [`${localApplications}/flatpak-missing.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Flatpak Missing Game",
        Exec: "flatpak run com.example.MissingGame",
      }),
    });
    existingPaths.add(
      "/home/tester/.local/share/flatpak/exports/bin/com.example.UserGame"
    );
    existingPaths.add("/var/lib/flatpak/exports/bin/com.example.SystemGame");

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });
    const byTitle = new Map(
      candidates.map((candidate) => [candidate.title, candidate])
    );

    assert.equal(
      byTitle.get("Flatpak User Game")?.executablePath,
      "/home/tester/.local/share/flatpak/exports/bin/com.example.UserGame"
    );
    assert.equal(
      byTitle.get("Flatpak System Game")?.executablePath,
      "/var/lib/flatpak/exports/bin/com.example.SystemGame"
    );
    // No exports bin and a non-path command — nothing to register.
    assert.equal(byTitle.get("Flatpak Missing Game")?.executablePath, null);
  });

  it("unwraps env VAR=… commands before resolving the executable", () => {
    const { fs, existingPaths } = createFakeFilesystem({
      [`${localApplications}/env.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Env Game",
        Exec: "env WINEPREFIX=/prefix /opt/env-game/start",
      }),
    });
    existingPaths.add("/opt/env-game/start");

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].executablePath, "/opt/env-game/start");
  });

  it("marks Game categories as a hint and keeps absolute icons only", () => {
    const { fs } = createFakeFilesystem({
      [`${localApplications}/game.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Puzzle Game",
        Exec: "/opt/puzzle/puzzle",
        Categories: "Game;LogicGame;",
        Icon: "/opt/puzzle/icon.png",
      }),
      [`${localApplications}/utility.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Text Editor",
        Exec: "/usr/bin/editor",
        Categories: "Utility;TextEditor;",
        Icon: "accessories-text-editor",
      }),
    });

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });
    const byTitle = new Map(
      candidates.map((candidate) => [candidate.title, candidate])
    );

    assert.equal(byTitle.get("Puzzle Game")?.isGameHint, true);
    assert.equal(byTitle.get("Puzzle Game")?.iconPath, "/opt/puzzle/icon.png");
    assert.equal(byTitle.get("Text Editor")?.isGameHint, false);
    assert.equal(byTitle.get("Text Editor")?.iconPath, null);
  });

  it("skips Hytale desktop entries — the hytale module owns that candidate", () => {
    const { fs, existingPaths } = createFakeFilesystem({
      [`${localApplications}/hytale.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Hytale",
        Exec: "flatpak run com.hypixel.HytaleLauncher",
      }),
    });
    existingPaths.add(
      "/home/tester/.local/share/flatpak/exports/bin/com.hypixel.HytaleLauncher"
    );

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });

    assert.deepEqual(candidates, []);
  });

  it("skips the launcher's own desktop entry", () => {
    const { fs, existingPaths } = createFakeFilesystem({
      [`${localApplications}/hydra.desktop`]: desktopEntry({
        Type: "Application",
        Name: "Hydra Plus",
        Exec: "/opt/hydra-plus/hydra-plus",
      }),
    });
    existingPaths.add("/opt/hydra-plus/hydra-plus");

    const candidates = buildDesktopEntryCandidates({ homeDir, fs });

    assert.deepEqual(candidates, []);
  });
});
