import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWindowsUninstallCandidates,
  type WindowsUninstallScanDeps,
} from "./windows-uninstall.js";

interface UninstallEntry {
  displayName?: string;
  displayIcon?: string;
}

const createRegistryDeps = (
  entriesByHive: Record<"HKCU" | "HKLM", Record<string, UninstallEntry>>
): WindowsUninstallScanDeps => ({
  listRegistryKeys: async ({ hive }) => Object.keys(entriesByHive[hive] ?? {}),
  readRegistryValue: async ({ hive, key, value }) => {
    const subkeyName = key.split("\\").pop() ?? "";
    const entry = entriesByHive[hive]?.[subkeyName];
    if (!entry) return null;
    if (value === "DisplayName") return entry.displayName ?? null;
    if (value === "DisplayIcon") return entry.displayIcon ?? null;
    return null;
  },
  locations: [{ hive: "HKCU" }, { hive: "HKLM" }],
});

describe("windows uninstall registry scanner", () => {
  it("strips the icon index suffix and quotes from DisplayIcon", async () => {
    const deps = createRegistryDeps({
      HKCU: {
        Celeste: {
          displayName: "Celeste",
          displayIcon: '"C:\\Program Files\\Celeste\\Celeste.exe",0',
        },
        "Some Tool": {
          displayName: "Some Tool",
          displayIcon: "C:\\Program Files\\Tool\\unins000.exe,7",
        },
      },
      HKLM: {},
    });

    const candidates = await buildWindowsUninstallCandidates(deps);

    assert.equal(candidates.length, 2);
    const celeste = candidates.find(
      (candidate) => candidate.title === "Celeste"
    );
    assert.ok(celeste);
    assert.equal(
      celeste.executablePath,
      "C:\\Program Files\\Celeste\\Celeste.exe"
    );
    assert.equal(celeste.source, "windows_registry");
    assert.equal(celeste.platform, "windows");
    assert.equal(celeste.isGameHint, false);
    assert.deepEqual(celeste.savePaths, []);

    const tool = candidates.find(
      (candidate) => candidate.title === "Some Tool"
    );
    assert.ok(tool);
    assert.equal(tool.executablePath, "C:\\Program Files\\Tool\\unins000.exe");
  });

  it("skips entries without a DisplayName or with non-exe icons", async () => {
    const deps = createRegistryDeps({
      HKCU: {
        NoName: { displayIcon: "C:\\Games\\A\\a.exe" },
        NoIcon: { displayName: "No Icon" },
        MsiIcon: {
          displayName: "MSI Product",
          displayIcon: "C:\\Windows\\Installer\\product.msi,0",
        },
        Good: {
          displayName: "Good Game",
          displayIcon: "C:\\Games\\Good\\good.exe",
        },
      },
      HKLM: {},
    });

    const candidates = await buildWindowsUninstallCandidates(deps);

    assert.deepEqual(
      candidates.map((candidate) => candidate.title),
      ["Good Game"]
    );
  });

  it("caps the result at 200 candidates sorted by title", async () => {
    const entries: Record<string, UninstallEntry> = {};
    for (let index = 0; index < 250; index += 1) {
      const paddedIndex = String(index).padStart(3, "0");
      entries[`Entry ${index}`] = {
        displayName: `Installed Program ${paddedIndex}`,
        displayIcon: `C:\\Program Files\\Program ${paddedIndex}\\program.exe`,
      };
    }

    const deps = createRegistryDeps({ HKCU: entries, HKLM: {} });
    const candidates = await buildWindowsUninstallCandidates(deps);

    assert.equal(candidates.length, 200);
    assert.equal(candidates[0].title, "Installed Program 000");
    assert.equal(candidates[199].title, "Installed Program 199");
  });

  it("merges both hives and dedupes identical titles with identical icons", async () => {
    const entry = {
      displayName: "Dual Game",
      displayIcon: "C:\\Games\\Dual\\dual.exe",
    };
    const deps = createRegistryDeps({
      HKCU: { DualGame: entry },
      HKLM: { DualGame: entry },
    });

    const candidates = await buildWindowsUninstallCandidates(deps);

    assert.equal(candidates.length, 1);
    assert.match(candidates[0].id, /^windows-registry-[0-9a-f]{16}$/);
  });

  it("tolerates registry failures by resolving to empty results", async () => {
    const candidates = await buildWindowsUninstallCandidates({
      listRegistryKeys: async () => {
        throw new Error("registry unavailable");
      },
      readRegistryValue: async () => null,
      locations: [{ hive: "HKLM" }],
    });

    assert.deepEqual(candidates, []);
  });
});
