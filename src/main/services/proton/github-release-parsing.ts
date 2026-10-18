import type { ProtonRelease } from "@types";

/**
 * Pure parsing of GitHub release API payloads into `ProtonRelease`
 * entries. Kept free of network/Node dependencies so it can be unit
 * tested with fixture JSON.
 */

export interface GitHubReleaseAssetPayload {
  name?: string;
  size?: number;
  browser_download_url?: string;
  /** GitHub provides "sha256:<hex>" (the field may be missing or empty). */
  digest?: string;
}

export interface GitHubReleasePayload {
  tag_name?: string;
  name?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: GitHubReleaseAssetPayload[];
}

const ARCHIVE_EXTENSION_PATTERN = /\.(tar\.gz|tgz|tar\.xz|txz|zip)$/i;

export const isArchiveAssetName = (assetName: string): boolean =>
  ARCHIVE_EXTENSION_PATTERN.test(assetName);

export const stripArchiveExtension = (assetName: string): string =>
  assetName.replace(ARCHIVE_EXTENSION_PATTERN, "");

/**
 * The installable asset stem must equal the release tag (GE-Proton
 * publishes `<tag>.tar.gz`) or the tag's default x86_64 variant
 * (CachyOS publishes `<tag>-x86_64.tar.gz`), compared case-insensitively.
 */
export const matchesReleaseAsset = (
  assetName: string,
  tag: string
): boolean => {
  if (!isArchiveAssetName(assetName)) return false;

  const normalizedTag = tag.toLowerCase();
  const stem = stripArchiveExtension(assetName).toLowerCase();

  return stem === normalizedTag || stem === `${normalizedTag}-x86_64`;
};

export const selectReleaseAsset = (
  release: GitHubReleasePayload
): GitHubReleaseAssetPayload | null => {
  if (!release.tag_name) return null;

  return (
    release.assets?.find((asset) =>
      asset.name
        ? matchesReleaseAsset(asset.name, release.tag_name as string)
        : false
    ) ?? null
  );
};

/**
 * Skips drafts and prereleases, picks the matching archive asset and
 * maps the payload to the shared release shape. Releases without a
 * matching asset are dropped entirely.
 */
export const parseGitHubReleasesPage = (
  payload: GitHubReleasePayload[]
): ProtonRelease[] => {
  const releases: ProtonRelease[] = [];

  for (const release of payload) {
    if (release.draft || release.prerelease) continue;

    const asset = selectReleaseAsset(release);
    if (!asset || !asset.browser_download_url) continue;

    releases.push({
      tag: release.tag_name as string,
      name: release.name || (release.tag_name as string),
      publishedAt: release.published_at ?? "",
      sizeBytes: asset.size ?? 0,
      downloadUrl: asset.browser_download_url,
      ...(asset.digest ? { digest: asset.digest } : {}),
    });
  }

  return releases;
};

export const getAssetFileNameFromDownloadUrl = (
  downloadUrl: string
): string | null => {
  try {
    const fileName = new URL(downloadUrl).pathname.split("/").pop();
    return fileName && fileName.length > 0 ? fileName : null;
  } catch {
    return null;
  }
};
