import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LAUNCH_FLAG_CATALOG,
  getLaunchFlagDefinition,
  mergeLegacyLaunchToggles,
  resolveLaunchFlags,
  type LaunchFlagAvailabilityProbe,
} from "./launch-flags.js";

const allAvailable: LaunchFlagAvailabilityProbe = {
  mangohud: true,
  gamemode: true,
  gamescope: true,
};

const nothingAvailable: LaunchFlagAvailabilityProbe = {
  mangohud: false,
  gamemode: false,
  gamescope: false,
};

describe("launch flag catalog", () => {
  it("has unique kebab-case ids", () => {
    const ids = LAUNCH_FLAG_CATALOG.map((definition) => definition.id);

    assert.equal(new Set(ids).size, ids.length);

    for (const id of ids) {
      assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("carries exact env assignments and wrapper executables", () => {
    assert.deepEqual(
      LAUNCH_FLAG_CATALOG.filter((definition) => definition.kind === "env").map(
        (definition) => definition.value
      ),
      [
        "DXVK_ASYNC=1",
        "DXVK_HDR=1",
        "PROTON_ENABLE_NVAPI=1",
        "PROTON_ENABLE_HDR=1",
        "PROTON_LOG=1",
        "VKD3D_SHADER_CACHE=1",
        "PROTON_FSR4_UPGRADE=1",
      ]
    );

    assert.deepEqual(
      LAUNCH_FLAG_CATALOG.filter(
        (definition) => definition.kind === "wrapper"
      ).map((definition) => definition.value),
      ["mangohud", "gamemoderun", "gamescope"]
    );
  });

  it("exposes definitions by id", () => {
    assert.equal(getLaunchFlagDefinition("dxvk-async")?.value, "DXVK_ASYNC=1");
    assert.equal(getLaunchFlagDefinition("gamemode")?.value, "gamemoderun");
    assert.equal(getLaunchFlagDefinition("não-existe"), undefined);
  });
});

describe("resolveLaunchFlags", () => {
  it("resolves env flags into assignments", () => {
    const resolution = resolveLaunchFlags(
      ["dxvk-async", "proton-log"],
      allAvailable
    );

    assert.deepEqual(resolution.env, {
      DXVK_ASYNC: "1",
      PROTON_LOG: "1",
    });
    assert.deepEqual(resolution.wrapperCommands, []);
    assert.deepEqual(resolution.unknownFlagIds, []);
    assert.deepEqual(resolution.unavailableFlagIds, []);
  });

  it("resolves wrapper flags in canonical nesting order", () => {
    const resolution = resolveLaunchFlags(
      ["gamescope", "mangohud", "gamemode"],
      allAvailable
    );

    // ProtonPlus wrapper registry order: mangohud 10 → gamemode 20 →
    // gamescope 30 — i.e. `mangohud gamemoderun gamescope <command>`.
    assert.deepEqual(resolution.wrapperCommands, [
      "mangohud",
      "gamemoderun",
      "gamescope",
    ]);
  });

  it("drops wrapper flags whose host tool is unavailable", () => {
    const resolution = resolveLaunchFlags(
      ["mangohud", "gamemode", "gamescope", "dxvk-async"],
      nothingAvailable
    );

    assert.deepEqual(resolution.wrapperCommands, []);
    assert.deepEqual(resolution.unavailableFlagIds, [
      "mangohud",
      "gamemode",
      "gamescope",
    ]);
    // Env flags are inert without their consumers and always pass.
    assert.deepEqual(resolution.env, { DXVK_ASYNC: "1" });
  });

  it("drops every wrapper flag when no availability probe is given", () => {
    const resolution = resolveLaunchFlags(["mangohud", "dxvk-hdr"]);

    assert.deepEqual(resolution.wrapperCommands, []);
    assert.deepEqual(resolution.unavailableFlagIds, ["mangohud"]);
    assert.deepEqual(resolution.env, { DXVK_HDR: "1" });
  });

  it("ignores and reports unknown flag ids", () => {
    const resolution = resolveLaunchFlags(
      ["dxvk-async", "made-up-flag"],
      allAvailable
    );

    assert.deepEqual(resolution.env, { DXVK_ASYNC: "1" });
    assert.deepEqual(resolution.unknownFlagIds, ["made-up-flag"]);
  });

  it("deduplicates repeated ids", () => {
    const resolution = resolveLaunchFlags(
      ["dxvk-async", "dxvk-async", "mangohud", "mangohud"],
      allAvailable
    );

    assert.deepEqual(resolution.env, { DXVK_ASYNC: "1" });
    assert.deepEqual(resolution.wrapperCommands, ["mangohud"]);
  });

  it("accepts null, undefined and empty inputs", () => {
    for (const flagIds of [null, undefined, []]) {
      const resolution = resolveLaunchFlags(flagIds, allAvailable);

      assert.deepEqual(resolution.env, {});
      assert.deepEqual(resolution.wrapperCommands, []);
    }
  });
});

describe("mergeLegacyLaunchToggles", () => {
  it("keeps the legacy gamemoderun wrapper for autoRunGamemode", () => {
    const merged = mergeLegacyLaunchToggles(resolveLaunchFlags(null), {
      useGamemode: true,
    });

    assert.deepEqual(merged.wrapperCommands, ["gamemoderun"]);
    assert.deepEqual(merged.env, {});
  });

  it("keeps the legacy MANGOHUD=1 env for autoRunMangohud", () => {
    const merged = mergeLegacyLaunchToggles(resolveLaunchFlags(null), {
      useMangohud: true,
    });

    assert.deepEqual(merged.env, { MANGOHUD: "1" });
    assert.deepEqual(merged.wrapperCommands, []);
  });

  it("collapses a gamemode flag and the legacy toggle into one wrapper", () => {
    const merged = mergeLegacyLaunchToggles(
      resolveLaunchFlags(["gamemode"], allAvailable),
      { useGamemode: true }
    );

    assert.deepEqual(merged.wrapperCommands, ["gamemoderun"]);
  });

  it("combines flags with both legacy toggles without duplication", () => {
    const merged = mergeLegacyLaunchToggles(
      resolveLaunchFlags(["gamescope", "mangohud", "gamemode"], allAvailable),
      { useMangohud: true, useGamemode: true }
    );

    assert.deepEqual(merged.wrapperCommands, [
      "mangohud",
      "gamemoderun",
      "gamescope",
    ]);
    assert.deepEqual(merged.env, { MANGOHUD: "1" });
  });

  it("inserts the legacy gamemoderun at its catalog position", () => {
    // Without the gamemode flag the toggle must still nest between
    // mangohud and gamescope (ProtonPlus order), not at the end.
    const merged = mergeLegacyLaunchToggles(
      resolveLaunchFlags(["gamescope"], allAvailable),
      { useGamemode: true }
    );

    assert.deepEqual(merged.wrapperCommands, ["gamemoderun", "gamescope"]);
  });

  it("returns the resolution unchanged without toggles", () => {
    const resolution = resolveLaunchFlags(["dxvk-async", "mangohud"], {
      ...nothingAvailable,
      mangohud: true,
    });
    const merged = mergeLegacyLaunchToggles(resolution);

    assert.deepEqual(merged, resolution);
  });
});

describe("merge precedence with the user's free-text launchOptions", () => {
  it("keeps explicit user env assignments above flag env", () => {
    // This mirrors the service merge (umu.ts / proton-launcher.ts):
    //   { ...serviceEnv, ...launchFlagToggles.env,
    //     ...resolvedLaunchCommand.env, ...extraEnv }
    // where resolvedLaunchCommand.env holds the leading `NAME=value`
    // assignments from the user's free-text launchOptions.
    const flagEnv = mergeLegacyLaunchToggles(
      resolveLaunchFlags(["dxvk-async", "proton-log"], allAvailable),
      { useMangohud: true }
    ).env;

    const userTextEnv = { DXVK_ASYNC: "0", MANGOHUD: "0" };

    const mergedEnv = {
      WINEPREFIX: "/prefix",
      ...flagEnv,
      ...userTextEnv,
    };

    assert.deepEqual(mergedEnv, {
      WINEPREFIX: "/prefix",
      DXVK_ASYNC: "0",
      PROTON_LOG: "1",
      MANGOHUD: "0",
    });
  });
});
