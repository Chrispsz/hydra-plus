import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCloudSaveAccessAction } from "./cloud-save-access.js";

describe("getCloudSaveAccessAction", () => {
  it("asks for sign-in first", () => {
    assert.equal(getCloudSaveAccessAction(false, false), "sign-in");
    assert.equal(getCloudSaveAccessAction(false, true), "sign-in");
  });

  it("opens when Drive is linked", () => {
    assert.equal(getCloudSaveAccessAction(true, true), "open");
  });

  it("asks to connect Drive when the account is not linked", () => {
    assert.equal(getCloudSaveAccessAction(true, false), "connect-drive");
  });
});
