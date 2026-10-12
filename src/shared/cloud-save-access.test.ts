import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCloudSaveAccessAction } from "./cloud-save-access.js";

describe("getCloudSaveAccessAction", () => {
  it("opens when Drive is linked", () => {
    assert.equal(getCloudSaveAccessAction(true), "open");
  });

  it("asks to connect Drive when it is not linked", () => {
    assert.equal(getCloudSaveAccessAction(false), "connect-drive");
  });
});
