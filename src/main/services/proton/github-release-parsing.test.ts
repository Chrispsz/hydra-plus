import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getAssetFileNameFromDownloadUrl,
  isArchiveAssetName,
  matchesReleaseAsset,
  parseGitHubReleasesPage,
  stripArchiveExtension,
  type GitHubReleasePayload,
} from "./github-release-parsing.ts";

const geProtonFixture: GitHubReleasePayload[] = [
  {
    tag_name: "GE-Proton9-20",
    name: "GE-Proton 9-20",
    draft: false,
    prerelease: false,
    published_at: "2024-10-01T10:00:00Z",
    assets: [
      {
        name: "GE-Proton9-20.tar.gz",
        size: 413_696_704,
        browser_download_url:
          "https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton9-20/GE-Proton9-20.tar.gz",
        digest: "sha256:" + "a".repeat(64),
      },
      {
        name: "GE-Proton9-20.sha512sum",
        size: 128,
        browser_download_url: "https://example.com/sum",
      },
    ],
  },
  {
    tag_name: "GE-Proton9-19",
    name: "Draft build",
    draft: true,
    prerelease: false,
    assets: [
      {
        name: "GE-Proton9-19.tar.gz",
        size: 1,
        browser_download_url: "https://example.com/19",
      },
    ],
  },
  {
    tag_name: "GE-Proton9-18",
    name: "Pre-release build",
    draft: false,
    prerelease: true,
    assets: [
      {
        name: "GE-Proton9-18.tar.gz",
        size: 1,
        browser_download_url: "https://example.com/18",
      },
    ],
  },
  {
    tag_name: "GE-Proton9-17",
    name: "No matching asset",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "GE-Proton9-17.tar.gz.sha512sum",
        size: 1,
        browser_download_url: "https://example.com/17",
      },
    ],
  },
];

describe("GitHub release asset matching", () => {
  it("recognizes archive extensions", () => {
    for (const name of [
      "a.tar.gz",
      "b.TAR.GZ",
      "c.tgz",
      "d.tar.xz",
      "e.txz",
      "f.zip",
    ]) {
      assert.equal(isArchiveAssetName(name), true, name);
    }

    for (const name of ["a.sha512sum", "b.txt", "tar.gz", "c.tar.gz2"]) {
      assert.equal(isArchiveAssetName(name), false, name);
    }
  });

  it("matches the GE-Proton convention (asset stem equals the tag)", () => {
    assert.equal(
      matchesReleaseAsset("GE-Proton9-20.tar.gz", "GE-Proton9-20"),
      true
    );
    assert.equal(
      matchesReleaseAsset("ge-proton9-20.TAR.GZ", "GE-Proton9-20"),
      true
    );
    assert.equal(
      matchesReleaseAsset("GE-Proton9-20.tar.gz.sha512sum", "GE-Proton9-20"),
      false
    );
  });

  it("matches the CachyOS x86_64 variant convention", () => {
    assert.equal(
      matchesReleaseAsset(
        "proton-cachyos-10.1-x86_64.tar.gz",
        "proton-cachyos-10.1"
      ),
      true
    );
    assert.equal(
      matchesReleaseAsset(
        "proton-cachyos-10.1-v3-x86_64.tar.gz",
        "proton-cachyos-10.1"
      ),
      false
    );
    assert.equal(
      matchesReleaseAsset("proton-cachyos-10.1.tar.gz", "proton-cachyos-10.1"),
      true
    );
  });

  it("strips only the archive extension", () => {
    assert.equal(
      stripArchiveExtension("GE-Proton9-20.tar.gz"),
      "GE-Proton9-20"
    );
    assert.equal(
      stripArchiveExtension("a.tar.gz.sha512sum"),
      "a.tar.gz.sha512sum"
    );
  });
});

describe("parseGitHubReleasesPage", () => {
  it("drops drafts, prereleases and releases without a matching asset", () => {
    const releases = parseGitHubReleasesPage(geProtonFixture);

    assert.deepEqual(
      releases.map((release) => release.tag),
      ["GE-Proton9-20"]
    );
  });

  it("maps the release and asset fields", () => {
    const [release] = parseGitHubReleasesPage(geProtonFixture);

    assert.equal(release.name, "GE-Proton 9-20");
    assert.equal(release.publishedAt, "2024-10-01T10:00:00Z");
    assert.equal(release.sizeBytes, 413_696_704);
    assert.equal(
      release.downloadUrl,
      "https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton9-20/GE-Proton9-20.tar.gz"
    );
    assert.equal(release.digest, "sha256:" + "a".repeat(64));
  });

  it("keeps releases whose digest is missing or unusable", () => {
    const payload: GitHubReleasePayload[] = [
      {
        tag_name: "v1",
        published_at: "2024-01-01T00:00:00Z",
        assets: [
          {
            name: "v1.tar.gz",
            size: 10,
            browser_download_url: "https://example.com/v1.tar.gz",
          },
        ],
      },
    ];

    const [release] = parseGitHubReleasesPage(payload);
    assert.equal(release.digest, undefined);
    assert.equal(release.name, "v1");
  });
});

describe("getAssetFileNameFromDownloadUrl", () => {
  it("extracts the asset file name from a GitHub download url", () => {
    assert.equal(
      getAssetFileNameFromDownloadUrl(
        "https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton9-20/GE-Proton9-20.tar.gz"
      ),
      "GE-Proton9-20.tar.gz"
    );
  });

  it("returns null for invalid urls", () => {
    assert.equal(getAssetFileNameFromDownloadUrl("not a url"), null);
    assert.equal(getAssetFileNameFromDownloadUrl("https://example.com/"), null);
  });
});
