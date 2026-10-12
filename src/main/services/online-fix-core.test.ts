import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOnlineFixDllOverrides,
  buildWindowsOnlineFixPath,
  findOnlineFixMarkerDlls,
  isSkippableDllName,
  MAX_SCANNED_DLL_OVERRIDES,
  sanitizeOnlineFixIni,
} from "./online-fix-core.js";

const findEntry = (overrides: string, name: string) =>
  overrides
    .split(";")
    .find((entry) => entry.startsWith(`${name}=`) || entry === name);

describe("buildOnlineFixDllOverrides", () => {
  it("never emits a strict native override anywhere in the string", () => {
    // Wine's loader (map_pe_file) returns STATUS_DLL_NOT_FOUND when a
    // strict `=n` override resolves to a Wine built-in — the recurring
    // "error 126". Every entry must be `=n,b` (native first, built-in
    // fallback) so a missing native file can never kill the load.
    const overrides = buildOnlineFixDllOverrides([
      "OnlineFix64.dll",
      "dxgi.dll",
      "d3d11.dll",
      "eos_sdk.dll",
      "winmm.dll",
      "SOME-GAME_HOOK.dll",
    ]);
    for (const entry of overrides.split(";")) {
      assert.equal(entry.endsWith("=n,b"), true, `strict entry: ${entry}`);
    }
  });

  it("forces the classic fix proxy DLLs as native,builtin", () => {
    const overrides = buildOnlineFixDllOverrides([]);
    for (const proxy of ["winmm", "version", "dinput8", "winhttp"]) {
      assert.equal(findEntry(overrides, proxy), `${proxy}=n,b`);
    }
  });

  it("forces the Online-Fix payload family as native,builtin even without a scan", () => {
    const overrides = buildOnlineFixDllOverrides([]);
    for (const payload of [
      "onlinefix64",
      "steamoverlay64",
      "dnet",
      "steam_api64",
      "steamclient64",
    ]) {
      assert.equal(findEntry(overrides, payload), `${payload}=n,b`);
    }
  });

  it("maps scanned DLLs to native,builtin", () => {
    const overrides = buildOnlineFixDllOverrides([
      "OnlineFix64.dll",
      "Steam_API64.DLL",
      "SOME-GAME_HOOK.dll",
      "eos_sdk.dll",
      "winmm.dll",
    ]);

    assert.equal(findEntry(overrides, "onlinefix64"), "onlinefix64=n,b");
    assert.equal(findEntry(overrides, "steam_api64"), "steam_api64=n,b");
    assert.equal(findEntry(overrides, "eos_sdk"), "eos_sdk=n,b");
    assert.equal(findEntry(overrides, "some-game_hook"), "some-game_hook=n,b");
    assert.equal(findEntry(overrides, "winmm"), "winmm=n,b");
  });

  it("emits each scanned system-named DLL exactly once (no D3D family)", () => {
    const overrides = buildOnlineFixDllOverrides(["dxgi.dll", "d3d11.dll"]);
    const entries = overrides.split(";");
    assert.equal(entries.filter((entry) => entry.startsWith("dxgi")).length, 1);
    assert.equal(
      entries.filter((entry) => entry.startsWith("d3d11")).length,
      1
    );
    assert.ok(entries.includes("dxgi=n,b"));
    assert.ok(entries.includes("d3d11=n,b"));
  });

  it("skips API-set shims", () => {
    const overrides = buildOnlineFixDllOverrides([
      "api-ms-win-crt-runtime-l1-1-0.dll",
      "ext-ms-win-thing.dll",
    ]);
    assert.equal(
      findEntry(overrides, "api-ms-win-crt-runtime-l1-1-0"),
      undefined
    );
    assert.equal(findEntry(overrides, "ext-ms-win-thing"), undefined);
  });

  it("caps scanned DLLs to keep the env sane", () => {
    const names = Array.from(
      { length: MAX_SCANNED_DLL_OVERRIDES + 20 },
      (_, index) => `gamemod${index}.dll`
    );
    const overrides = buildOnlineFixDllOverrides(names);
    const scanned = overrides
      .split(";")
      .filter((entry) => entry.startsWith("gamemod")).length;
    assert.equal(scanned, MAX_SCANNED_DLL_OVERRIDES);
  });

  it("is idempotent for duplicated names", () => {
    const overrides = buildOnlineFixDllOverrides(["winmm.dll", "winmm.dll"]);
    const entries = overrides.split(";");
    assert.equal(
      entries.filter((entry) => entry.startsWith("winmm")).length,
      1
    );
    assert.ok(entries.includes("winmm=n,b"));
  });
});

describe("isSkippableDllName", () => {
  it("flags API-set and extension shims", () => {
    assert.ok(isSkippableDllName("api-ms-win-core-file-l1-1.dll"));
    assert.ok(isSkippableDllName("ext-ms-win-session-thing.dll"));
    assert.equal(isSkippableDllName("steam_api64"), false);
  });
});

describe("sanitizeOnlineFixIni", () => {
  it("disables ExtraProtection and captures FakeAppId", () => {
    const result = sanitizeOnlineFixIni(
      "[Misc]\nExtraProtection = true\n[Fake]\nFakeAppId = 1234567\n"
    );
    assert.ok(result.changed);
    assert.ok(!/ExtraProtection\s*=\s*true/i.test(result.content));
    assert.ok(/ExtraProtection\s*=\s*false/i.test(result.content));
    assert.equal(result.fakeAppId, "1234567");
  });

  it("leaves a clean ini untouched and reports no fake app id", () => {
    const content = "[Misc]\nExtraProtection = false\n";
    const result = sanitizeOnlineFixIni(content);
    assert.ok(!result.changed);
    assert.equal(result.content, content);
    assert.equal(result.fakeAppId, null);
  });
});

describe("findOnlineFixMarkerDlls", () => {
  it("detects the patch payload among scanned files", () => {
    assert.deepEqual(
      findOnlineFixMarkerDlls([
        "OnlineFix64.dll",
        "steam_api64.dll",
        "game.exe",
      ]),
      ["onlinefix64.dll"]
    );
  });

  it("returns empty when the patch is missing (quarantine)", () => {
    assert.deepEqual(
      findOnlineFixMarkerDlls(["game.exe", "unityplayer.dll"]),
      []
    );
  });
});

describe("buildWindowsOnlineFixPath", () => {
  it("prepends the game directory to PATH", () => {
    const result = buildWindowsOnlineFixPath(
      "C:\\Games\\Some Game",
      "C:\\Windows\\system32;C:\\Windows"
    );
    assert.equal(
      result,
      "C:\\Games\\Some Game;C:\\Windows\\system32;C:\\Windows"
    );
  });

  it("does not duplicate an existing game directory entry", () => {
    const result = buildWindowsOnlineFixPath(
      "C:\\Games\\Game",
      "c:\\games\\game;C:\\Windows"
    );
    assert.equal(result, "C:\\Games\\Game;C:\\Windows");
  });

  it("works with an empty current PATH", () => {
    assert.equal(
      buildWindowsOnlineFixPath("C:\\Games\\Game", ""),
      "C:\\Games\\Game"
    );
  });
});
