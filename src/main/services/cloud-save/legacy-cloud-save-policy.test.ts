import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { assertLegacyCloudSaveWriteAllowed } from "./legacy-cloud-save-policy.ts";

describe("legacy cloud save write policy", () => {
  it("allows legacy writes for every remaining game (no emulator gating)", () => {
    assert.doesNotThrow(() =>
      assertLegacyCloudSaveWriteAllowed({
        shop: "steam",
        platform: null,
      } as never)
    );
    assert.doesNotThrow(() =>
      assertLegacyCloudSaveWriteAllowed({
        shop: "custom",
        platform: null,
      } as never)
    );
    assert.doesNotThrow(() => assertLegacyCloudSaveWriteAllowed(null));
    assert.doesNotThrow(() => assertLegacyCloudSaveWriteAllowed(undefined));
  });
});
