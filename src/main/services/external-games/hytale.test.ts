import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildHytaleCandidates,
  getHytaleDataRoots,
  HYTALE_APP_ID,
  type HytaleScanFilesystem,
} from "./hytale.js";

const createFakeFilesystem = (layout: {
  directories?: string[];
  files?: Record<string, string>;
}): HytaleScanFilesystem => {
  const directories = new Set(layout.directories ?? []);
  const files = new Map(Object.entries(layout.files ?? {}));

  return {
    existsSync: (targetPath) =>
      directories.has(targetPath) || files.has(targetPath),
    readFileSync: (targetPath) => {
      const contents = files.get(targetPath);
      if (contents === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return contents;
    },
    readdirSync: (dirPath) => {
      if (!directories.has(dirPath)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      const separator = dirPath.includes("\\") ? "\\" : "/";
      const prefix = dirPath.endsWith(separator)
        ? dirPath
        : dirPath + separator;
      const children = new Set<string>();
      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue;
        const remainder = directory.slice(prefix.length);
        if (remainder) children.add(remainder.split(/[\\/]/)[0]);
      }
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const remainder = file.slice(prefix.length);
        if (remainder) children.add(remainder.split(/[\\/]/)[0]);
      }
      return [...children];
    },
    statSync: (targetPath) => ({
      isDirectory: () => directories.has(targetPath),
    }),
  };
};

const win = path.win32.join;
const posix = path.posix.join;

describe("hytale candidate builder", () => {
  it("builds the Windows candidate from the globbed install layout", async () => {
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";
    const hytaleRoot = win(appData, "Hytale");
    const gameDir = win(hytaleRoot, "install", "release", "package", "game");
    const savesDir = win(hytaleRoot, "UserData", "Saves");
    const settingsFile = win(hytaleRoot, "Settings.json");
    const clientExecutable = win(
      gameDir,
      "latest",
      "Client",
      "HytaleClient.exe"
    );

    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir: "C:\\Users\\Tester",
      fs: createFakeFilesystem({
        directories: [
          appData,
          hytaleRoot,
          win(hytaleRoot, "install"),
          win(hytaleRoot, "install", "release"),
          win(gameDir),
          win(gameDir, "latest"),
          savesDir,
        ],
        files: { [clientExecutable]: "binary", [settingsFile]: "{}" },
      }),
    });

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate.title, "Hytale");
    assert.equal(candidate.source, "hytale");
    assert.equal(candidate.platform, "windows");
    assert.equal(candidate.isGameHint, true);
    assert.equal(candidate.executablePath, clientExecutable);
    assert.deepEqual(candidate.savePaths, [savesDir, settingsFile]);
    assert.match(candidate.id, /^hytale-[0-9a-f]{16}$/);
  });

  it("returns no candidates when the Windows data root is missing", async () => {
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";

    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir: "C:\\Users\\Tester",
      fs: createFakeFilesystem({ directories: [appData] }),
    });

    assert.deepEqual(candidates, []);
  });

  it("ignores an empty Hytale root without install or save evidence", async () => {
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";
    const hytaleRoot = win(appData, "Hytale");

    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir: "C:\\Users\\Tester",
      fs: createFakeFilesystem({ directories: [appData, hytaleRoot] }),
    });

    assert.deepEqual(candidates, []);
  });

  it("prefers the launcher exe from the registry probe over the client glob", async () => {
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";
    const hytaleRoot = win(appData, "Hytale");
    const gameDir = win(hytaleRoot, "install", "release", "package", "game");
    const clientExecutable = win(
      gameDir,
      "latest",
      "Client",
      "HytaleClient.exe"
    );
    const launcherExecutable = "C:\\Program Files\\Hytale\\hytale-launcher.exe";

    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir: "C:\\Users\\Tester",
      fs: createFakeFilesystem({
        directories: [
          appData,
          hytaleRoot,
          win(hytaleRoot, "install", "release", "package", "game", "latest"),
        ],
        files: {
          [clientExecutable]: "binary",
          [launcherExecutable]: "binary",
          [win(hytaleRoot, "Settings.json")]: "{}",
        },
      }),
      readRegistry: async ({ value }) =>
        value === "LauncherPath" ? `"${launcherExecutable}"` : null,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].executablePath, launcherExecutable);
  });

  it("resolves a registry InstallLocation directory to the launcher inside it", async () => {
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";
    const hytaleRoot = win(appData, "Hytale");
    const launcherDirectory = "D:\\Hytale";
    const launcherExecutable = win(launcherDirectory, "hytale-launcher.exe");

    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir: "C:\\Users\\Tester",
      fs: createFakeFilesystem({
        directories: [
          appData,
          hytaleRoot,
          hytaleRoot + "\\UserData\\Saves",
          launcherDirectory,
        ],
        files: { [launcherExecutable]: "binary" },
      }),
      readRegistry: async ({ value }) =>
        value === "InstallLocation" ? launcherDirectory : null,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].executablePath, launcherExecutable);
  });

  it("keeps the save-path matrix even when no executable is found", async () => {
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";
    const hytaleRoot = win(appData, "Hytale");
    const savesDir = win(hytaleRoot, "UserData", "Saves");
    const settingsFile = win(hytaleRoot, "Settings.json");

    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir: "C:\\Users\\Tester",
      fs: createFakeFilesystem({
        directories: [appData, hytaleRoot, savesDir],
        files: { [settingsFile]: "{}" },
      }),
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].executablePath, null);
    assert.deepEqual(candidates[0].savePaths, [savesDir, settingsFile]);
  });

  it("surfaces unverified patchline siblings for save detection only", async () => {
    const appData = "C:\\Users\\Tester\\AppData\\Roaming";
    const hytaleRoot = win(appData, "Hytale");
    const preReleaseRoot = win(appData, "Hytale_pre-release");
    const emptyRoot = win(appData, "Hytale_empty");

    const candidates = await buildHytaleCandidates({
      platform: "win32",
      env: { APPDATA: appData },
      homeDir: "C:\\Users\\Tester",
      fs: createFakeFilesystem({
        directories: [
          appData,
          hytaleRoot,
          win(hytaleRoot, "UserData", "Saves"),
          preReleaseRoot,
          win(preReleaseRoot, "UserData", "Saves"),
          emptyRoot,
        ],
        files: {
          [win(hytaleRoot, "Settings.json")]: "{}",
          [win(preReleaseRoot, "Settings.json")]: '{"patchline":"pre-release"}',
        },
      }),
    });

    assert.equal(candidates.length, 2);

    const [primary, sibling] = candidates;
    assert.equal(primary.title, "Hytale");
    assert.equal(primary.executablePath, null);
    assert.equal(sibling.title, "Hytale (pre-release)");
    assert.equal(sibling.executablePath, null);
    assert.deepEqual(sibling.savePaths, [
      win(preReleaseRoot, "UserData", "Saves"),
      win(preReleaseRoot, "Settings.json"),
    ]);
  });

  it("detects the Linux Flatpak data root and its exports bin", async () => {
    const homeDir = "/home/tester";
    const flatpakRoot = posix(
      homeDir,
      ".var",
      "app",
      HYTALE_APP_ID,
      "data",
      "Hytale"
    );
    const userExportsBin = posix(
      homeDir,
      ".local",
      "share",
      "flatpak",
      "exports",
      "bin",
      HYTALE_APP_ID
    );

    const candidates = await buildHytaleCandidates({
      platform: "linux",
      env: {},
      homeDir,
      fs: createFakeFilesystem({
        directories: [flatpakRoot, posix(flatpakRoot, "UserData", "Saves")],
        files: {
          [posix(flatpakRoot, "Settings.json")]: "{}",
          [userExportsBin]: "script",
        },
      }),
    });

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate.title, "Hytale (Flatpak)");
    assert.equal(candidate.platform, "linux");
    assert.equal(candidate.source, "hytale");
    assert.equal(candidate.executablePath, userExportsBin);
    assert.deepEqual(candidate.savePaths, [
      posix(flatpakRoot, "UserData", "Saves"),
      posix(flatpakRoot, "Settings.json"),
    ]);
  });

  it("falls back to the system flatpak exports bin", async () => {
    const homeDir = "/home/tester";
    const flatpakRoot = posix(
      homeDir,
      ".var",
      "app",
      HYTALE_APP_ID,
      "data",
      "Hytale"
    );
    const systemExportsBin = posix(
      "/var/lib/flatpak/exports/bin",
      HYTALE_APP_ID
    );

    const candidates = await buildHytaleCandidates({
      platform: "linux",
      env: {},
      homeDir,
      fs: createFakeFilesystem({
        directories: [flatpakRoot, posix(flatpakRoot, "UserData", "Saves")],
        files: { [systemExportsBin]: "script" },
      }),
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].executablePath, systemExportsBin);
  });

  it("emits the Linux native candidate with an empty executable", async () => {
    const homeDir = "/home/tester";
    const nativeRoot = posix(homeDir, ".local", "share", "Hytale");
    const savesDir = posix(nativeRoot, "UserData", "Saves");

    const candidates = await buildHytaleCandidates({
      platform: "linux",
      env: {},
      homeDir,
      fs: createFakeFilesystem({
        directories: [nativeRoot, savesDir],
        files: { [posix(nativeRoot, "Settings.json")]: "{}" },
      }),
    });

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate.title, "Hytale");
    assert.equal(candidate.executablePath, null);
    assert.deepEqual(candidate.savePaths, [
      savesDir,
      posix(nativeRoot, "Settings.json"),
    ]);
  });

  it("honors XDG_DATA_HOME for the native data root", () => {
    const candidates = getHytaleDataRoots({
      platform: "linux",
      env: { XDG_DATA_HOME: "/data/custom" },
      homeDir: "/home/tester",
    });

    assert.deepEqual(
      candidates.map(({ root }) => root),
      [
        "/home/tester/.var/app/com.hypixel.HytaleLauncher/data/Hytale",
        "/data/custom/Hytale",
      ]
    );
  });

  it("returns no roots for non-desktop platforms", () => {
    assert.deepEqual(
      getHytaleDataRoots({ platform: "darwin", env: {}, homeDir: "/Users/t" }),
      []
    );
  });
});
