import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROTON_PROVIDERS,
  getProtonProviderById,
  toProtonProviderList,
} from "./providers.ts";

describe("Proton provider registry", () => {
  it("registers the LEAN provider set with GitHub repos", () => {
    assert.deepEqual(
      PROTON_PROVIDERS.map((provider) => provider.id),
      ["ge-proton", "proton-cachyos"]
    );

    const geProton = getProtonProviderById("ge-proton");
    assert.equal(geProton?.repo, "GloriousEggroll/proton-ge-custom");

    const cachyos = getProtonProviderById("proton-cachyos");
    assert.equal(cachyos?.repo, "CachyOS/proton-cachyos");
  });

  it("returns null for unknown providers", () => {
    assert.equal(getProtonProviderById("does-not-exist"), null);
  });

  it("exposes the registry as the shared provider list", () => {
    const providers = toProtonProviderList();

    assert.equal(providers.length, PROTON_PROVIDERS.length);
    for (const provider of providers) {
      assert.ok(provider.id);
      assert.ok(provider.name);
      assert.match(provider.repo, /^[\w.-]+\/[\w.-]+$/);
    }
    assert.equal(typeof providers[0].description, "string");
    assert.equal(providers[1].description, undefined);
  });
});
