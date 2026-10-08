import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCloudSaveAccessAction } from "./cloud-save-access.js";

describe("cloud save access", () => {
  it("sends unauthenticated users to sign in", () => {
    assert.equal(getCloudSaveAccessAction(false, false), "sign-in");
    assert.equal(getCloudSaveAccessAction(false, false, true), "sign-in");
    assert.equal(
      getCloudSaveAccessAction(false, false, false, true),
      "sign-in"
    );
  });

  it("opens cloud saves when the user's own cloud provider is linked", () => {
    assert.equal(getCloudSaveAccessAction(true, false, true), "open");
    assert.equal(getCloudSaveAccessAction(false, false, true), "sign-in");
  });

  it("sends authenticated users without Drive to the free connect flow", () => {
    assert.equal(getCloudSaveAccessAction(true, false), "connect-drive");
    assert.equal(
      getCloudSaveAccessAction(true, false, false, true),
      "connect-drive"
    );
  });

  it("keeps the paywall only for builds without the OAuth client", () => {
    assert.equal(
      getCloudSaveAccessAction(true, false, false, false),
      "paywall"
    );
  });

  it("opens cloud saves for active legacy subscribers", () => {
    assert.equal(getCloudSaveAccessAction(true, true), "open");
    assert.equal(getCloudSaveAccessAction(true, true, false, false), "open");
  });
});
