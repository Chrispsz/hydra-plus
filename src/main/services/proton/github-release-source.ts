import axios from "axios";
import { appVersion } from "@main/constants";

import type { ProtonReleasesPage } from "./release-catalog";
import {
  parseGitHubReleasesPage,
  type GitHubReleasePayload,
} from "./github-release-parsing";

/**
 * Stateless GitHub releases source. One page per request, no pagination
 * state — browsing/caching is handled by the release catalog.
 */

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
export const GITHUB_RELEASES_PER_PAGE = 25;

const toGitHubSourceError = (error: unknown): Error => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;

    if (status === 403 || status === 429) {
      return new Error("proton_rate_limited", { cause: error });
    }

    return new Error("proton_network_error", { cause: error });
  }

  return error instanceof Error ? error : new Error("proton_network_error");
};

export const fetchGitHubReleasesPage = async (
  repo: string,
  page = 1
): Promise<ProtonReleasesPage> => {
  try {
    const response = await axios.get<GitHubReleasePayload[]>(
      `${GITHUB_API_BASE_URL}/repos/${repo}/releases`,
      {
        params: { per_page: GITHUB_RELEASES_PER_PAGE, page },
        timeout: GITHUB_REQUEST_TIMEOUT_MS,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Hydra/${appVersion}`,
        },
      }
    );

    const rawPayload = Array.isArray(response.data) ? response.data : [];

    return {
      releases: parseGitHubReleasesPage(rawPayload),
      hasMore: rawPayload.length >= GITHUB_RELEASES_PER_PAGE,
    };
  } catch (error) {
    throw toGitHubSourceError(error);
  }
};
