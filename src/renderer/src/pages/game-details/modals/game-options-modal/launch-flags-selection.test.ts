import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as launchFlagsSelection from "./launch-flags-selection.ts";

const { isLaunchFlagDisabled, isLaunchFlagEnabled, toggleLaunchFlagId } =
  launchFlagsSelection;

describe("game options launch flags selection", () => {
  describe("toggleLaunchFlagId", () => {
    it("enables a flag by appending its id", () => {
      assert.deepEqual(toggleLaunchFlagId([], "mangohud", true), ["mangohud"]);
      assert.deepEqual(toggleLaunchFlagId(["proton-log"], "mangohud", true), [
        "proton-log",
        "mangohud",
      ]);
    });

    it("does not duplicate an already enabled flag", () => {
      assert.deepEqual(toggleLaunchFlagId(["mangohud"], "mangohud", true), [
        "mangohud",
      ]);
    });

    it("disables a flag by removing its id", () => {
      assert.deepEqual(
        toggleLaunchFlagId(["mangohud", "proton-log"], "mangohud", false),
        ["proton-log"]
      );
    });

    it("keeps the list unchanged when disabling a missing flag", () => {
      assert.deepEqual(toggleLaunchFlagId(["proton-log"], "mangohud", false), [
        "proton-log",
      ]);
      assert.deepEqual(toggleLaunchFlagId([], "mangohud", false), []);
    });

    it("treats null and undefined records as empty", () => {
      assert.deepEqual(toggleLaunchFlagId(null, "mangohud", true), [
        "mangohud",
      ]);
      assert.deepEqual(toggleLaunchFlagId(undefined, "mangohud", true), [
        "mangohud",
      ]);
      assert.deepEqual(toggleLaunchFlagId(null, "mangohud", false), []);
    });
  });

  describe("isLaunchFlagEnabled", () => {
    it("reflects the persisted ids", () => {
      assert.equal(isLaunchFlagEnabled(["mangohud"], "mangohud"), true);
      assert.equal(isLaunchFlagEnabled(["mangohud"], "gamemode"), false);
      assert.equal(isLaunchFlagEnabled(null, "mangohud"), false);
      assert.equal(isLaunchFlagEnabled(undefined, "mangohud"), false);
    });
  });

  describe("isLaunchFlagDisabled", () => {
    const everythingAvailable = { mangohud: true, gamemode: true };
    const nothingAvailable = { mangohud: false, gamemode: false };

    it("gates wrapper flags on their host tool probe", () => {
      assert.equal(
        isLaunchFlagDisabled({ availability: "mangohud" }, nothingAvailable),
        true
      );
      assert.equal(
        isLaunchFlagDisabled({ availability: "gamemode" }, nothingAvailable),
        true
      );
      assert.equal(
        isLaunchFlagDisabled({ availability: "mangohud" }, everythingAvailable),
        false
      );
      assert.equal(
        isLaunchFlagDisabled({ availability: "gamemode" }, everythingAvailable),
        false
      );
    });

    it("keeps env flags and gamescope enabled without a renderer probe", () => {
      assert.equal(
        isLaunchFlagDisabled({ availability: undefined }, nothingAvailable),
        false
      );
      assert.equal(
        isLaunchFlagDisabled({ availability: "gamescope" }, nothingAvailable),
        false
      );
    });
  });
});
