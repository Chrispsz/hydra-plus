import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as visibilityModule from "./cloud-save-visibility.ts";

const { getCloudSaveVisibility } = visibilityModule;

describe("cloud save visibility", () => {
  it("uses V2 for Steam games", () => {
    assert.deepEqual(getCloudSaveVisibility("steam"), {
      hero: "v2",
      settings: {
        showV2: true,
      },
    });
  });

  it("uses V2 for custom (manually imported) games too", () => {
    assert.deepEqual(getCloudSaveVisibility("custom"), {
      hero: "v2",
      settings: {
        showV2: true,
      },
    });
  });

  it("ignores the platform when deciding visibility", () => {
    for (const platform of [
      "Sony PlayStation 3",
      "Nintendo Game Boy Advance",
      "Unknown Console",
    ]) {
      assert.equal(getCloudSaveVisibility("steam", platform).hero, "v2");
      assert.equal(getCloudSaveVisibility("custom", platform).hero, "v2");
    }
  });

  it("hides cloud save for launchbox games", () => {
    const visibility = getCloudSaveVisibility("launchbox");
    assert.equal(visibility.hero, null);
    assert.equal(visibility.settings.showV2, false);
  });
});
