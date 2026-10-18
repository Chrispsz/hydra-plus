import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProtonRelease } from "@types";

import {
  ProtonReleaseCatalog,
  type ReleasePageFetcher,
} from "./release-catalog.ts";
import type { ProtonProviderDefinition } from "./providers.ts";

const provider: ProtonProviderDefinition = {
  id: "ge-proton",
  name: "GE-Proton",
  repo: "GloriousEggroll/proton-ge-custom",
};

const makeRelease = (tag: string): ProtonRelease => ({
  tag,
  name: tag,
  publishedAt: "2024-10-01T00:00:00Z",
  sizeBytes: 100,
  downloadUrl: `https://example.com/${tag}.tar.gz`,
});

describe("ProtonReleaseCatalog", () => {
  it("caches a page per provider for one hour", async () => {
    let fetchCount = 0;
    const fetchPage: ReleasePageFetcher = async () => {
      fetchCount += 1;
      return { releases: [makeRelease("GE-1")], hasMore: false };
    };

    let clock = 1_000_000;
    const catalog = new ProtonReleaseCatalog({ fetchPage, now: () => clock });

    await catalog.getReleases(provider, 1);
    await catalog.getReleases(provider, 1);
    assert.equal(fetchCount, 1);

    clock += 59 * 60 * 1000;
    await catalog.getReleases(provider, 1);
    assert.equal(fetchCount, 1);

    clock += 2 * 60 * 1000;
    await catalog.getReleases(provider, 1);
    assert.equal(fetchCount, 2);
  });

  it("caches pages independently per provider and page", async () => {
    const fetched: string[] = [];
    const fetchPage: ReleasePageFetcher = async (repo, page) => {
      fetched.push(`${repo}:${page}`);
      return { releases: [makeRelease(`tag-${page}`)], hasMore: page < 2 };
    };

    const catalog = new ProtonReleaseCatalog({ fetchPage, now: () => 0 });

    await catalog.getReleases(provider, 1);
    await catalog.getReleases(provider, 2);
    await catalog.getReleases(provider, 1);
    await catalog.getReleases(
      { ...provider, id: "proton-cachyos", repo: "CachyOS/proton-cachyos" },
      1
    );

    assert.deepEqual(fetched, [
      "GloriousEggroll/proton-ge-custom:1",
      "GloriousEggroll/proton-ge-custom:2",
      "CachyOS/proton-cachyos:1",
    ]);
  });

  it("finds a release by tag across pages and stops at the last page", async () => {
    const fetchPage: ReleasePageFetcher = async (_repo, page) => ({
      releases: [makeRelease(`GE-${page}`)],
      hasMore: page < 3,
    });

    const catalog = new ProtonReleaseCatalog({ fetchPage, now: () => 0 });

    const found = await catalog.findReleaseByTag(provider, "GE-2");
    assert.equal(found?.tag, "GE-2");

    const missing = await catalog.findReleaseByTag(provider, "GE-99");
    assert.equal(missing, null);
  });

  it("propagates fetch errors without caching them", async () => {
    let shouldFail = true;
    const fetchPage: ReleasePageFetcher = async () => {
      if (shouldFail) throw new Error("proton_rate_limited");
      return { releases: [makeRelease("GE-1")], hasMore: false };
    };

    const catalog = new ProtonReleaseCatalog({ fetchPage, now: () => 0 });

    await assert.rejects(
      () => catalog.getReleases(provider, 1),
      /proton_rate_limited/
    );

    shouldFail = false;
    const page = await catalog.getReleases(provider, 1);
    assert.equal(page.releases[0]?.tag, "GE-1");
  });
});
