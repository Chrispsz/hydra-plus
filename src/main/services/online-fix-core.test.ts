import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOnlineFixDllOverrides,
  isSkippableDllName,
  MAX_SCANNED_DLL_OVERRIDES,
} from "./online-fix-core.js";

const findEntry = (overrides: string, name: string) =>
  overrides
    .split(";")
    .find((entry) => entry.startsWith(`${name}=`) || entry === name);

describe("buildOnlineFixDllOverrides", () => {
  it("always includes the community D3D recipe", () => {
    const overrides = buildOnlineFixDllOverrides([]);
    for (const required of [
      "d3d11=n",
      "d3d10=n",
      "d3d10core=n",
      "dxgi=n",
      "openvr_api_dxvk=n",
      "d3d12=n",
      "d3d12core=n",
      "d3d9=n",
      "d3d8=n",
    ]) {
      assert.ok(overrides.split(";").includes(required), `missing ${required}`);
    }
  });

  it("forces the classic fix proxy DLLs as native,builtin", () => {
    const overrides = buildOnlineFixDllOverrides([]);
    for (const proxy of ["winmm", "version", "dinput8", "winhttp"]) {
      assert.equal(findEntry(overrides, proxy), `${proxy}=n,b`);
    }
  });

  it("maps every game-shipped DLL to native,builtin", () => {
    const overrides = buildOnlineFixDllOverrides([
      "OnlineFix64.dll",
      "Steam_API64.DLL",
      "SOME-GAME_HOOK.dll",
    ]);

    assert.equal(findEntry(overrides, "onlinefix64"), "onlinefix64=n,b");
    assert.equal(findEntry(overrides, "steam_api64"), "steam_api64=n,b");
    assert.equal(findEntry(overrides, "some-game_hook"), "some-game_hook=n,b");
  });

  it("never duplicates the D3D family from the folder scan", () => {
    const overrides = buildOnlineFixDllOverrides(["dxgi.dll", "d3d11.dll"]);
    const entries = overrides.split(";");
    assert.equal(entries.filter((entry) => entry.startsWith("dxgi")).length, 1);
    assert.equal(
      entries.filter((entry) => entry.startsWith("d3d11")).length,
      1
    );
    assert.ok(entries.includes("dxgi=n"));
    assert.ok(entries.includes("d3d11=n"));
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
