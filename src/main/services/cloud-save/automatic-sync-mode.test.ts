import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCloudSaveAutomaticSyncStateForMode,
  getNextCloudSaveAutomaticSyncMode,
  resolveCloudSaveAutomaticSyncMode,
  resolveStoredCloudSaveAutomaticSyncMode,
  shouldRunV2AutomaticCloudSave,
} from "./automatic-sync-mode.js";

describe("cloud save automatic sync mode", () => {
  it("maps the stored v2 flag to the mode", () => {
    assert.equal(resolveCloudSaveAutomaticSyncMode(true), "v2");
    assert.equal(resolveCloudSaveAutomaticSyncMode(false), "disabled");
  });

  it("migrates legacy-enabled games to v2 when no v2 flag exists", () => {
    assert.equal(
      resolveStoredCloudSaveAutomaticSyncMode(true, undefined),
      "v2"
    );
  });

  it("prefers the stored v2 flag over the legacy flag", () => {
    assert.equal(
      resolveStoredCloudSaveAutomaticSyncMode(true, false),
      "disabled"
    );
    assert.equal(resolveStoredCloudSaveAutomaticSyncMode(false, true), "v2");
  });

  it("disables when neither flag exists", () => {
    assert.equal(
      resolveStoredCloudSaveAutomaticSyncMode(false, undefined),
      "disabled"
    );
  });

  it("exposes the persistence state for a mode", () => {
    assert.deepEqual(getCloudSaveAutomaticSyncStateForMode("v2"), {
      legacyEnabled: false,
      v2Enabled: true,
    });
    assert.deepEqual(getCloudSaveAutomaticSyncStateForMode("disabled"), {
      legacyEnabled: false,
      v2Enabled: false,
    });
  });

  it("toggles the v2 target without touching other modes", () => {
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("disabled", "v2", true),
      "v2"
    );
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("v2", "v2", false),
      "disabled"
    );
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("disabled", "v2", false),
      "disabled"
    );
  });

  it("runs only the v2 engine", () => {
    assert.equal(shouldRunV2AutomaticCloudSave("v2"), true);
    assert.equal(shouldRunV2AutomaticCloudSave("disabled"), false);
  });
});
