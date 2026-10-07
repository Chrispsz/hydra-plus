import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as visibilityModule from "./cloud-save-visibility.ts";

const { getCloudSaveVisibility, isLegacyCloudSaveSettingsAvailable } =
  visibilityModule;

describe("cloud save visibility", () => {
  it("uses V2 for Steam and keeps legacy saves as an archive", () => {
    assert.deepEqual(getCloudSaveVisibility("steam"), {
      hero: "v2",
      settings: {
        showV2: true,
        showLegacy: true,
        legacyPurpose: "archive",
      },
    });
  });

  it("keeps only legacy cloud saves for non-Steam games", () => {
    for (const shop of ["custom"] as const) {
      assert.deepEqual(getCloudSaveVisibility(shop), {
        hero: null,
        settings: {
          showV2: false,
          showLegacy: true,
          legacyPurpose: "active",
        },
      });
    }
  });

  it("ignores the platform when deciding visibility", () => {
    for (const platform of [
      "Sony PlayStation 3",
      "Nintendo Game Boy Advance",
      "Unknown Console",
    ]) {
      assert.deepEqual(getCloudSaveVisibility("steam", platform), {
        hero: "v2",
        settings: {
          showV2: true,
          showLegacy: true,
          legacyPurpose: "archive",
        },
      });
      assert.deepEqual(getCloudSaveVisibility("custom", platform).hero, null);
    }
  });

  it("shows active legacy settings without requiring existing artifacts", () => {
    const settings = getCloudSaveVisibility("custom").settings;

    assert.equal(isLegacyCloudSaveSettingsAvailable(settings, false, 0), true);
  });

  it("shows archived legacy saves only to subscribers with artifacts", () => {
    const settings = getCloudSaveVisibility("steam").settings;

    assert.equal(isLegacyCloudSaveSettingsAvailable(settings, false, 1), false);
    assert.equal(isLegacyCloudSaveSettingsAvailable(settings, true, 0), false);
    assert.equal(isLegacyCloudSaveSettingsAvailable(settings, true, 2), true);
  });
});
