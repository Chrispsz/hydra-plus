import type { ProtonRelease } from "@types";

import type { ProtonProviderDefinition } from "./providers";

/**
 * Release catalog with a 1h per-(provider, page) cache. The fetcher is
 * injected so tests can drive the cache without network access.
 */

const RELEASES_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RELEASE_SEARCH_PAGES = 10;

export interface ProtonReleasesPage {
  releases: ProtonRelease[];
  hasMore: boolean;
}

export type ReleasePageFetcher = (
  repo: string,
  page: number
) => Promise<ProtonReleasesPage>;

interface CachedReleasePage {
  page: ProtonReleasesPage;
  fetchedAt: number;
}

export class ProtonReleaseCatalog {
  private readonly fetchPage: ReleasePageFetcher;
  private readonly now: () => number;
  private readonly cache = new Map<string, CachedReleasePage>();

  constructor(options: { fetchPage: ReleasePageFetcher; now?: () => number }) {
    this.fetchPage = options.fetchPage;
    this.now = options.now ?? (() => Date.now());
  }

  public async getReleases(
    provider: ProtonProviderDefinition,
    page = 1
  ): Promise<ProtonReleasesPage> {
    const cacheKey = `${provider.id}:${page}`;
    const cached = this.cache.get(cacheKey);
    const now = this.now();

    if (cached && now - cached.fetchedAt < RELEASES_CACHE_TTL_MS) {
      return cached.page;
    }

    const fetched = await this.fetchPage(provider.repo, page);
    this.cache.set(cacheKey, { page: fetched, fetchedAt: now });
    return fetched;
  }

  /**
   * Walks pages (bounded) until a release with the given tag shows up.
   * Already-cached pages are free, so reinstalling a version the user
   * just browsed does not refetch it.
   */
  public async findReleaseByTag(
    provider: ProtonProviderDefinition,
    tag: string
  ): Promise<ProtonRelease | null> {
    for (let page = 1; page <= MAX_RELEASE_SEARCH_PAGES; page++) {
      const { releases, hasMore } = await this.getReleases(provider, page);
      const release = releases.find((entry) => entry.tag === tag);

      if (release) return release;
      if (!hasMore) break;
    }

    return null;
  }

  public clear(): void {
    this.cache.clear();
  }
}
