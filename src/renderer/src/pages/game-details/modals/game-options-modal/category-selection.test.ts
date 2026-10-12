import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as categorySelectionModule from "./category-selection.ts";

const {
  getAvailableGameSettingsCategory,
  shouldInitializeGameSettingsCategory,
} = categorySelectionModule;

describe("game options category selection", () => {
  it("initializes when the modal opens", () => {
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: false, initialCategory: "general" },
        { visible: true, initialCategory: "general" }
      ),
      true
    );
  });

  it("keeps hydra_cloud when v2 settings are shown", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showDownloadSettings: true,
      }),
      "hydra_cloud"
    );
  });

  it("falls back to general while the user still needs to connect Drive", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "connect-drive",
        showCloudSaveV2Settings: true,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("falls back to general when v2 settings are unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: false,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("falls back to general when the user is not signed in", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "connect-drive",
        showCloudSaveV2Settings: true,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("falls back to general when downloads are unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("downloads", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showDownloadSettings: false,
      }),
      "general"
    );
  });

  it("keeps any other category untouched", () => {
    assert.equal(
      getAvailableGameSettingsCategory("general", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showDownloadSettings: true,
      }),
      "general"
    );
  });
});
