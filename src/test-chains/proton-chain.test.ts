/**
 * CHAIN C — "a GE-Proton build from GitHub release to a running game".
 *
 * One continuous scenario per sub-test: the release the user picks in the
 * Proton manager is the exact release that gets downloaded, verified with
 * real sha256, extracted with the real system tar, promoted atomically
 * over the previous build, listed by the compatibility-tools seam,
 * selected for the game, and finally turned into the umu/Proton launch
 * command with the user's launch flags and free-text options.
 *
 * Stage map:
 *   1. CATALOG    parseGitHubReleasesPage (github-release-parsing.ts) over
 *                 a realistic GE-Proton releases payload → ProtonRelease-
 *                 Catalog (release-catalog.ts, injected fetcher + clock)
 *                 with the real provider registry (providers.ts) → the
 *                 newest stable build, found again by tag through the
 *                 per-(provider, page) cache.
 *   2. DOWNLOAD+VERIFY  the install job's injected downloadArchive seam
 *                 (the same seam ProtonManager wires into
 *                 runProtonInstallJob) + verifyProtonArchive
 *                 (verification.ts) with REAL node:crypto sha256: the
 *                 honest archive passes, a flipped byte is rejected with
 *                 the documented error code.
 *   3. INSTALL TRANSACTION  the real extractProtonArchive (system tar) →
 *                 inspectStagedProton → promoteStagedProton (install-
 *                 transaction.ts): the promoted build replaces the
 *                 previous one atomically; an injected rename failure at
 *                 the promote step rolls the previous build back exactly
 *                 (the F2 "atomic promote + rollback" guarantee).
 *   4. LISTING    resolveInstallTarget + getCompatToolRoots (install-
 *                 targets.ts) — the root table umu scans — walked with the
 *                 shared isValidProtonDirectory rule.
 *   5. SELECTION  per-game proton precedence (game.protonPath ?? user
 *                 default — launch-game.ts resolveProtonPathForLaunch
 *                 l.250-270) replayed with the real validity predicate.
 *   6. ENV        the umu launch env (umu.ts l.579-589) and the direct
 *                 Proton STEAM_COMPAT_* env (proton-launcher.ts
 *                 buildProtonEnv l.114-145), asserted through the spread
 *                 order that keeps the user's free-text env on top.
 *   7. COMMAND    resolveLaunchCommand (helpers/resolve-launch-command.ts)
 *                 — the REAL resolver — producing both `<proton>/proton
 *                 waitforexitandrun <exe>` and the umu-run wrapper shape.
 *   8. FLAGS      LAUNCH_FLAG_CATALOG → resolveLaunchFlags with a fake
 *                 availability probe → mergeLegacyLaunchToggles → the
 *                 merged env precedence against a launchOptions string.
 *
 * Headless boundaries (honesty over coverage theater):
 *   - umu.ts and proton-launcher.ts import `electron` / `@electron-toolkit/
 *     utils` at module load, so Umu.getInstalledProtonVersions,
 *     buildProtonEnv and ProtonRunner cannot be imported by the headless
 *     runner. Stage 4 therefore chains install-targets.ts — the module
 *     that deliberately duplicates umu's compatibilitytool root table and
 *     the same isValidProtonDirectory rule (install-transaction.ts
 *     l.26-31) — and replays umu's per-root listing loop over that table.
 *     Stages 6-8 assert the documented env/command composition of umu.ts
 *     l.579-589 and proton-launcher.ts l.129-145 through their pure
 *     inputs (resolveLaunchFlags + mergeLegacyLaunchToggles + the real
 *     resolveLaunchCommand); every composed value is labelled with its
 *     production line.
 *   - resolve-launch-command.ts runtime-imports the
 *     `@main/events/helpers/parse-launch-options` alias, which ts-node/esm
 *     cannot resolve (it does not apply tsconfig `paths` to ESM
 *     specifiers). The chain registers helpers/alias-registry.mjs — a
 *     resolve hook that maps @main/* and @shared/* to real files for the
 *     DYNAMIC import inside scenario 3 and delegates everything else to
 *     the ts-node hook untouched — so the REAL resolver runs, not a copy.
 *   - resolveProtonPathForLaunch is a closure inside the Electron-bound
 *     launch-game.ts; stage 5 replays its exact documented precedence with
 *     the real validity predicate and labels the duplication.
 *   - The download leg goes through the job's injected downloadArchive
 *     seam — the real downloader streams over the network
 *     (archive-download.ts, Electron-free but not hermetic).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { register } from "node:module";
import { after, describe, it } from "node:test";

import type { ProtonInstallProgress, ProtonRelease } from "@types";
import {
  getAssetFileNameFromDownloadUrl,
  parseGitHubReleasesPage,
  type GitHubReleasePayload,
} from "../main/services/proton/github-release-parsing.js";
import { getProtonProviderById } from "../main/services/proton/providers.js";
import {
  ProtonReleaseCatalog,
  type ReleasePageFetcher,
} from "../main/services/proton/release-catalog.js";
import { verifyProtonArchive } from "../main/services/proton/verification.js";
import {
  getCompatToolRoots,
  resolveInstallTarget,
  validateProtonRemoval,
  type ProtonInstallTargetsInput,
} from "../main/services/proton/install-targets.js";
import {
  PREVIOUS_DIR_PREFIX,
  PROTON_METADATA_FILENAME,
  STAGING_DIR_PREFIX,
  createStagingDir,
  inspectStagedProton,
  isValidProtonDirectory,
  promoteStagedProton,
  type ProtonInstallMetadata,
} from "../main/services/proton/install-transaction.js";
import { runProtonInstallJob } from "../main/services/proton/install-job.js";
import { extractProtonArchive } from "../main/services/proton/archive-extraction.js";
import {
  resolveLaunchFlags,
  mergeLegacyLaunchToggles,
} from "../shared/launch-flags.js";

// ts-node/esm cannot resolve the tsconfig `paths` aliases that
// resolve-launch-command.ts uses for its runtime import of
// `@main/events/helpers/parse-launch-options`. This resolve hook (active
// for dynamic imports made after this call) rewrites the two aliases to
// real files and delegates everything else to the ts-node loader.
register(new URL("./helpers/alias-registry.mjs", import.meta.url));

const execFileAsync = promisify(execFile);

const GAME_TAG = "GE-Proton9-20";
const OLD_TAG = "GE-Proton9-19";
const GAME_OBJECT_ID = "hytale-custom-object-id";
const GAME_EXE = "/opt/hytale/install/release/package/game/HytaleClient.exe";

const roots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hydra-chain-c-"));
  roots.push(root);
  return root;
};

const isTarAvailable = async (): Promise<boolean> => {
  try {
    await execFileAsync("tar", ["--version"]);
    return true;
  } catch {
    return false;
  }
};

const createProtonSourceDir = async (
  parentDir: string,
  tag: string,
  protonScript = "#!/bin/sh\n"
): Promise<string> => {
  const sourceDir = path.join(parentDir, tag);
  await fsp.mkdir(path.join(sourceDir, "files"), { recursive: true });
  await fsp.writeFile(path.join(sourceDir, "proton"), protonScript);
  await fsp.writeFile(path.join(sourceDir, "toolmanifest.vdf"), '"manifest"\n');
  await fsp.writeFile(path.join(sourceDir, "files", "dist"), "payload");
  return sourceDir;
};

interface ArchiveFixture {
  archivePath: string;
  sizeBytes: number;
  digest: string;
}

const createTarGzFixture = async (
  parentDir: string,
  tag: string,
  protonScript?: string
): Promise<ArchiveFixture> => {
  const sourceDir = await createProtonSourceDir(parentDir, tag, protonScript);
  const archivePath = path.join(parentDir, `${tag}.tar.gz`);
  await execFileAsync("tar", [
    "-czf",
    archivePath,
    "-C",
    parentDir,
    path.basename(sourceDir),
  ]);
  const content = await fsp.readFile(archivePath);
  return {
    archivePath,
    sizeBytes: content.length,
    digest: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
  };
};

const toRelease = (fixture: ArchiveFixture, tag: string): ProtonRelease => ({
  tag,
  name: `GE-Proton ${tag.replace("GE-Proton", "")}`,
  publishedAt: "2024-10-01T10:00:00Z",
  sizeBytes: fixture.sizeBytes,
  downloadUrl: `https://github.com/GloriousEggroll/proton-ge-custom/releases/download/${tag}/${tag}.tar.gz`,
  digest: fixture.digest,
});

/**
 * A realistic GE-Proton releases payload in GitHub API order (newest
 * first): a prerelease and a draft that must be skipped, the newest
 * stable release carrying the real fixture's size + sha256 digest (GitHub
 * publishes `sha256:<hex>` digests on release assets), a stable release
 * without a matching archive asset and one older stable release.
 */
const geReleasesPayload = (fixture: ArchiveFixture): GitHubReleasePayload[] => [
  {
    tag_name: "GE-Proton9-22",
    name: "GE-Proton 9-22",
    draft: false,
    prerelease: true,
    published_at: "2024-10-08T10:00:00Z",
    assets: [
      {
        name: "GE-Proton9-22.tar.gz",
        size: 1,
        browser_download_url: "https://example.com/9-22.tar.gz",
      },
    ],
  },
  {
    tag_name: "GE-Proton9-21",
    name: "GE-Proton 9-21",
    draft: true,
    prerelease: false,
    published_at: "2024-10-05T10:00:00Z",
    assets: [
      {
        name: "GE-Proton9-21.tar.gz",
        size: 1,
        browser_download_url: "https://example.com/9-21.tar.gz",
      },
    ],
  },
  {
    tag_name: GAME_TAG,
    name: "GE-Proton 9-20",
    draft: false,
    prerelease: false,
    published_at: "2024-10-01T10:00:00Z",
    assets: [
      {
        name: `${GAME_TAG}.tar.gz`,
        size: fixture.sizeBytes,
        browser_download_url: `https://github.com/GloriousEggroll/proton-ge-custom/releases/download/${GAME_TAG}/${GAME_TAG}.tar.gz`,
        digest: fixture.digest,
      },
      {
        name: `${GAME_TAG}.sha512sum`,
        size: 128,
        browser_download_url: "https://example.com/9-20.sha512sum",
      },
    ],
  },
  {
    tag_name: "GE-Proton9-18",
    name: "GE-Proton 9-18",
    draft: false,
    prerelease: false,
    published_at: "2024-09-01T10:00:00Z",
    assets: [
      {
        name: "GE-Proton9-18.tar.gz.sha512sum",
        size: 128,
        browser_download_url: "https://example.com/9-18.sha512sum",
      },
    ],
  },
  {
    tag_name: OLD_TAG,
    name: "GE-Proton 9-19",
    draft: false,
    prerelease: false,
    published_at: "2024-09-20T10:00:00Z",
    assets: [
      {
        name: `${OLD_TAG}.tar.gz`,
        size: 1,
        browser_download_url: "https://example.com/9-19.tar.gz",
      },
    ],
  },
];

after(async () => {
  await Promise.all(
    roots.map((root) => fsp.rm(root, { recursive: true, force: true }))
  );
});

describe("chain C — a GE-Proton build from GitHub release to a running game", () => {
  it("scenario 1: catalog → download → verify → install promotes atomically over the previous build", async () => {
    if (!(await isTarAvailable())) return;

    const root = await createRoot();
    const fixture = await createTarGzFixture(root, GAME_TAG);

    // -- stage 1: CATALOG ----------------------------------------------------
    const parsedPageOne = parseGitHubReleasesPage(geReleasesPayload(fixture));
    assert.deepEqual(
      parsedPageOne.map((release) => release.tag),
      [GAME_TAG, OLD_TAG]
    );

    // The newest suitable build is the newest STABLE release with a
    // matching archive asset — GitHub serves releases newest-first, so it
    // is the first parsed entry (the prerelease and the draft above it
    // were dropped by the parser).
    const selected = parsedPageOne[0];
    assert.equal(selected.tag, GAME_TAG);
    assert.equal(selected.publishedAt, "2024-10-01T10:00:00Z");
    assert.equal(selected.sizeBytes, fixture.sizeBytes);
    assert.equal(selected.digest, fixture.digest);
    assert.equal(
      getAssetFileNameFromDownloadUrl(selected.downloadUrl),
      `${GAME_TAG}.tar.gz`
    );

    const provider = getProtonProviderById("ge-proton");
    assert.ok(provider, "the real GE-Proton provider exists");
    assert.equal(provider.repo, "GloriousEggroll/proton-ge-custom");

    let fetchCount = 0;
    const fetchPage: ReleasePageFetcher = async (repo, page) => {
      fetchCount += 1;
      assert.equal(repo, provider.repo);
      return {
        releases: page === 1 ? parsedPageOne : [],
        hasMore: page === 1,
      };
    };
    const catalog = new ProtonReleaseCatalog({ fetchPage, now: () => 1_000 });

    const pageOne = await catalog.getReleases(provider, 1);
    assert.deepEqual(
      pageOne.releases.map((release) => release.tag),
      [GAME_TAG, OLD_TAG]
    );
    assert.equal(pageOne.hasMore, true);

    // The manager installs by tag: already-cached pages are free.
    const release = await catalog.findReleaseByTag(provider, GAME_TAG);
    assert.deepEqual(release, selected);
    assert.equal(fetchCount, 1, "the tag resolved from the cached page");
    assert.equal(await catalog.findReleaseByTag(provider, "missing-tag"), null);
    assert.equal(fetchCount, 2, "a missing tag walked to the last page");

    // -- stages 2 + 3: DOWNLOAD → VERIFY → EXTRACT → PROMOTE ------------------
    // The install target is resolved exactly like ProtonManager does for
    // a user without an existing Steam install: the standard per-user
    // Steam compatibilitytools.d, created on demand by the transaction.
    const homeDir = path.join(root, "home");
    const targetsInput: ProtonInstallTargetsInput = {
      homePath: homeDir,
      libraryFolders: [],
      extraCompatToolPaths: [],
    };
    const { targetDir, isDefaultRoot } = resolveInstallTarget(targetsInput);
    assert.equal(isDefaultRoot, true);
    assert.equal(
      targetDir,
      path.join(homeDir, ".local", "share", "Steam", "compatibilitytools.d")
    );

    // The "previous build" the promotion must replace atomically.
    await createProtonSourceDir(targetDir, GAME_TAG, "old build\n");
    assert.equal(
      await fsp.readFile(path.join(targetDir, GAME_TAG, "proton"), "utf8"),
      "old build\n"
    );

    const phases: ProtonInstallProgress["phase"][] = [];
    await runProtonInstallJob({
      providerId: provider.id,
      release: selected,
      targetDir,
      workspaceDir: path.join(root, "workspace"),
      deps: {
        // The download seam: the real downloader streams over the network
        // (archive-download.ts, wired by ProtonManager); the chain
        // injects the deterministic byte source instead.
        downloadArchive: async ({ destinationPath, onProgress }) => {
          await fsp.copyFile(fixture.archivePath, destinationPath);
          onProgress?.(fixture.sizeBytes, fixture.sizeBytes);
        },
        extractArchive: extractProtonArchive,
      },
      signal: new AbortController().signal,
      onProgress: (payload) => phases.push(payload.phase),
    });

    // The full pipeline ran in order and promoted the new build over the
    // previous one — old files replaced, new directory live.
    assert.deepEqual(phases, [
      "downloading",
      "downloading",
      "verifying",
      "extracting",
      "promoting",
      "done",
    ]);
    const installedDir = path.join(targetDir, GAME_TAG);
    assert.equal(isValidProtonDirectory(installedDir), true);
    assert.equal(
      await fsp.readFile(path.join(installedDir, "proton"), "utf8"),
      "#!/bin/sh\n",
      "the old build was replaced by the promoted one"
    );
    assert.equal(
      await fsp.readFile(path.join(installedDir, "files", "dist"), "utf8"),
      "payload",
      "the extracted payload survived the promote"
    );
    const metadata = JSON.parse(
      await fsp.readFile(
        path.join(installedDir, PROTON_METADATA_FILENAME),
        "utf8"
      )
    ) as ProtonInstallMetadata;
    assert.equal(metadata.provider, provider.id);
    assert.equal(metadata.tag, GAME_TAG);
    assert.equal(metadata.assetName, `${GAME_TAG}.tar.gz`);

    // Transaction hygiene: no staging leftovers, no workspace, no backup.
    assert.equal(fs.existsSync(path.join(root, "workspace")), false);
    const targetParentEntries = await fsp.readdir(path.dirname(targetDir));
    assert.deepEqual(
      targetParentEntries.filter(
        (entry) =>
          entry.startsWith(STAGING_DIR_PREFIX) ||
          entry.startsWith(PREVIOUS_DIR_PREFIX)
      ),
      []
    );
  });

  it("scenario 2: a tampered download is rejected before install and a failed promote rolls the previous build back exactly", async () => {
    if (!(await isTarAvailable())) return;

    const root = await createRoot();
    const fixture = await createTarGzFixture(root, GAME_TAG);
    const release = toRelease(fixture, GAME_TAG);

    // -- stage 2 (tampering): a flipped byte must never reach the disk -----
    const honestBytes = await fsp.readFile(fixture.archivePath);
    const tampered = Buffer.from(honestBytes);
    tampered[tampered.length >> 1] ^= 0xff;
    const tamperedPath = path.join(root, "tampered.tar.gz");
    await fsp.writeFile(tamperedPath, tampered);
    assert.notEqual(
      crypto.createHash("sha256").update(tampered).digest("hex"),
      crypto.createHash("sha256").update(honestBytes).digest("hex"),
      "the fixture flip changed the archive hash"
    );

    // The verification seam with REAL node:crypto: the honest archive
    // passes both checks; the tampered copy fails the digest check with
    // the documented error code (one of ProtonManager's
    // PROTON_ERROR_CODES, pushed to the renderer as the "error" phase).
    assert.deepEqual(await verifyProtonArchive(fixture.archivePath, release), {
      ok: true,
    });
    assert.deepEqual(await verifyProtonArchive(tamperedPath, release), {
      ok: false,
      error: "proton_verification_digest_mismatch",
    });

    // Through the full job the tampered download is rejected and nothing
    // of it survives: the target keeps the previous build, the workspace
    // is cleaned up.
    const homeDir = path.join(root, "home");
    const targetsInput: ProtonInstallTargetsInput = {
      homePath: homeDir,
      libraryFolders: [],
      extraCompatToolPaths: [],
    };
    const targetDir = resolveInstallTarget(targetsInput).targetDir;
    await createProtonSourceDir(targetDir, GAME_TAG, "old build\n");
    const workspaceDir = path.join(root, "workspace");

    await assert.rejects(
      () =>
        runProtonInstallJob({
          providerId: "ge-proton",
          release,
          targetDir,
          workspaceDir,
          deps: {
            downloadArchive: async ({ destinationPath }) => {
              await fsp.writeFile(destinationPath, tampered);
            },
            extractArchive: extractProtonArchive,
          },
          signal: new AbortController().signal,
          onProgress: () => undefined,
        }),
      /proton_verification_digest_mismatch/
    );
    assert.equal(fs.existsSync(workspaceDir), false);
    assert.equal(
      await fsp.readFile(path.join(targetDir, GAME_TAG, "proton"), "utf8"),
      "old build\n",
      "the rejected download left the previous build untouched"
    );

    // -- stage 3 (rollback): a promote that fails mid-transaction restores
    // the previous state exactly (the F2 "atomic promote + rollback"
    // guarantee). The staging area is built by the REAL extraction path.
    const stagingDir = await createStagingDir(targetDir);
    await extractProtonArchive({
      archivePath: fixture.archivePath,
      destinationDir: stagingDir,
      signal: new AbortController().signal,
    });
    const { releaseDirName } = inspectStagedProton(stagingDir);
    assert.equal(releaseDirName, GAME_TAG);

    const failingRename: typeof fs.promises.rename = async (
      fromPath,
      toPath
    ) => {
      if (String(fromPath) === path.join(stagingDir, releaseDirName)) {
        throw new Error("simulated promote failure");
      }
      return fs.promises.rename(fromPath, toPath);
    };

    await assert.rejects(
      () =>
        promoteStagedProton({
          stagingDir,
          releaseDirName,
          targetDir,
          metadata: {
            provider: "ge-proton",
            tag: GAME_TAG,
            assetName: `${GAME_TAG}.tar.gz`,
            installedAt: "2024-10-01T00:00:00.000Z",
          },
          rename: failingRename,
        }),
      /simulated promote failure/
    );

    // The previous build was restored byte-for-byte, no backup siblings or
    // metadata were left behind, and the staged build survived for a retry.
    assert.equal(
      await fsp.readFile(
        path.join(targetDir, releaseDirName, "proton"),
        "utf8"
      ),
      "old build\n",
      "rollback restored the previous build exactly"
    );
    assert.equal(
      fs.existsSync(
        path.join(targetDir, releaseDirName, PROTON_METADATA_FILENAME)
      ),
      false,
      "rollback left no provenance metadata on the old build"
    );
    const rolledBackEntries = await fsp.readdir(path.dirname(targetDir));
    assert.deepEqual(
      rolledBackEntries.filter((entry) =>
        entry.startsWith(PREVIOUS_DIR_PREFIX)
      ),
      [],
      "the rollback left no backup siblings"
    );
    assert.equal(
      isValidProtonDirectory(path.join(stagingDir, releaseDirName)),
      true,
      "the staged build is still intact for a retry"
    );

    // The retry (real renames this time) completes the transaction: the
    // staged build moved into place and again no backup survived.
    await promoteStagedProton({
      stagingDir,
      releaseDirName,
      targetDir,
      metadata: {
        provider: "ge-proton",
        tag: GAME_TAG,
        assetName: `${GAME_TAG}.tar.gz`,
        installedAt: "2024-10-01T00:00:00.000Z",
      },
    });
    assert.equal(
      await fsp.readFile(
        path.join(targetDir, releaseDirName, "proton"),
        "utf8"
      ),
      "#!/bin/sh\n",
      "the retried promote replaced the old build"
    );
    assert.equal(
      fs.existsSync(path.join(stagingDir, releaseDirName)),
      false,
      "the staged build moved into the target"
    );
    assert.deepEqual(
      (await fsp.readdir(path.dirname(targetDir))).filter((entry) =>
        entry.startsWith(PREVIOUS_DIR_PREFIX)
      ),
      []
    );
  });

  it("scenario 3: the promoted build is listed, selected per game and launched with the user's flags last", async () => {
    const { resolveLaunchCommand } = await import(
      "../main/helpers/resolve-launch-command.js"
    );

    const root = await createRoot();
    const homeDir = path.join(root, "home");
    const targetsInput: ProtonInstallTargetsInput = {
      homePath: homeDir,
      libraryFolders: [],
      extraCompatToolPaths: [],
    };
    const targetDir = resolveInstallTarget(targetsInput).targetDir;

    // The promoted build (as scenarios 1 and 2 produced) plus an older
    // second one so game vs. user-default precedence is observable.
    await createProtonSourceDir(targetDir, GAME_TAG, "#!/bin/sh\n");
    await createProtonSourceDir(targetDir, OLD_TAG, "#!/bin/sh\n");
    const installedProtonPath = path.join(targetDir, GAME_TAG);
    const defaultProtonPath = path.join(targetDir, OLD_TAG);

    // -- stage 4: LISTING ------------------------------------------------------
    // Umu.getInstalledProtonVersions (umu.ts l.195) is Electron-bound;
    // install-targets.ts duplicates umu's root table on purpose and
    // install-transaction.ts holds the same isValidProtonDirectory rule
    // umu applies, so the chain replays umu's per-root listing loop
    // (readdir → validity → realpath → dedupe → name sort) over the real
    // root table. Only roots under the fixture home are considered so a
    // Steam installation on the host cannot leak into the assertion.
    const listedVersions = (
      await Promise.all(
        getCompatToolRoots(targetsInput)
          .filter((candidate) => candidate.path.startsWith(homeDir))
          .filter((candidate) => fs.existsSync(candidate.path))
          .map(async (candidate) => {
            const entries = await fsp
              .readdir(candidate.path, { withFileTypes: true })
              .catch(() => [] as fs.Dirent[]);
            return Promise.all(
              entries
                .filter((entry) => entry.isDirectory())
                .filter((entry) =>
                  isValidProtonDirectory(path.join(candidate.path, entry.name))
                )
                .map(async (entry) => {
                  const candidatePath = path.join(candidate.path, entry.name);
                  const realPath = await fsp.realpath(candidatePath);
                  return {
                    name: path.basename(realPath),
                    path: realPath,
                    source: "compatibility_tools" as const,
                  };
                })
            );
          })
      )
    )
      .flat()
      .sort((left, right) => left.name.localeCompare(right.name));

    assert.deepEqual(listedVersions, [
      {
        name: OLD_TAG,
        path: defaultProtonPath,
        source: "compatibility_tools",
      },
      {
        name: GAME_TAG,
        path: installedProtonPath,
        source: "compatibility_tools",
      },
    ]);

    // The listed build passes the manager's removal gate; a path outside
    // every known root never does.
    assert.deepEqual(
      validateProtonRemoval(
        installedProtonPath,
        getCompatToolRoots(targetsInput),
        isValidProtonDirectory
      ),
      { ok: true }
    );
    assert.deepEqual(
      validateProtonRemoval(
        path.join(root, "elsewhere", GAME_TAG),
        getCompatToolRoots(targetsInput),
        isValidProtonDirectory
      ),
      { ok: false, error: "proton_path_not_allowed" }
    );

    // -- stage 5: SELECTION -----------------------------------------------------
    // resolveProtonPathForLaunch (launch-game.ts l.250-270) is a closure
    // in the Electron-bound launch pipeline; its documented precedence is
    // replayed here with the REAL validity predicate (Umu.isValidProtonPath
    // applies the same isValidProtonDirectory rule — umu.ts l.22-27):
    //   game.protonPath when valid, else the user default when valid,
    //   else null.
    const resolveProtonPathForLaunch = (
      gameProtonPath: string | null | undefined,
      userPreferences: { defaultProtonPath?: string | null }
    ): string | null => {
      if (gameProtonPath && isValidProtonDirectory(gameProtonPath)) {
        return gameProtonPath;
      }
      const { defaultProtonPath } = userPreferences;
      if (defaultProtonPath && isValidProtonDirectory(defaultProtonPath)) {
        return defaultProtonPath;
      }
      return null;
    };

    const game = { protonPath: installedProtonPath };
    const preferences = { defaultProtonPath: defaultProtonPath };
    assert.equal(
      resolveProtonPathForLaunch(game.protonPath, preferences),
      installedProtonPath,
      "the game's own proton wins over the user default"
    );
    assert.equal(
      resolveProtonPathForLaunch("/bogus/missing-proton", preferences),
      defaultProtonPath,
      "an invalid game proton falls back to the user default"
    );
    assert.equal(
      resolveProtonPathForLaunch("/bogus/missing-proton", {
        defaultProtonPath: "/bogus/missing-proton",
      }),
      null,
      "no valid proton on either side resolves to null"
    );

    // -- stages 6 + 7 + 8: FLAGS, COMMAND and ENV ------------------------------
    // The catalog flags resolve with a deterministic availability probe
    // (umu/proton-launcher probe mangohud/gamemode/gamescope with
    // spawnSync before resolving — gamemode is missing on this host).
    const resolution = resolveLaunchFlags(
      ["mangohud", "gamemode", "gamescope", "dxvk-async", "made-up-flag"],
      { mangohud: true, gamemode: false, gamescope: true }
    );
    assert.deepEqual(resolution.wrapperCommands, ["mangohud", "gamescope"]);
    assert.deepEqual(resolution.unavailableFlagIds, ["gamemode"]);
    assert.deepEqual(resolution.unknownFlagIds, ["made-up-flag"]);
    assert.deepEqual(resolution.env, { DXVK_ASYNC: "1" });

    // The legacy toggles fold in without duplicating wrappers and keep
    // the catalog nesting order (mangohud → gamemoderun → gamescope).
    const toggles = mergeLegacyLaunchToggles(resolution, {
      useMangohud: true,
      useGamemode: true,
    });
    assert.deepEqual(toggles.wrapperCommands, [
      "mangohud",
      "gamemoderun",
      "gamescope",
    ]);
    assert.deepEqual(toggles.env, { DXVK_ASYNC: "1", MANGOHUD: "1" });

    // The umu launch command (umu.ts l.568-573, the python3-less shape):
    // umu-run wraps the game executable; the user's free-text options
    // expand %command% and contribute their leading env assignments, the
    // wrappers nest outermost-first around everything.
    const umuBinaryPath = "/opt/hydra/binaries/umu/umu-run";
    const resolvedLaunchCommand = resolveLaunchCommand({
      baseCommand: umuBinaryPath,
      baseArgs: [GAME_EXE, "--windowed"],
      launchOptions: "MANGOHUD=0 DXVK_ASYNC=0 %command% --fullscreen",
      wrapperCommands: toggles.wrapperCommands,
    });
    assert.deepEqual(resolvedLaunchCommand, {
      command: "mangohud",
      args: [
        "gamemoderun",
        "gamescope",
        umuBinaryPath,
        GAME_EXE,
        "--windowed",
        "--fullscreen",
      ],
      env: { MANGOHUD: "0", DXVK_ASYNC: "0" },
    });

    // The umu launch env (umu.ts l.579-589): GAMEID/WINEPREFIX/PROTONPATH
    // first, then the flag env, then the user's free-text env LAST —
    // explicit user assignments win over everything the launcher set.
    const winePrefixPath = path.join(
      root,
      "userData",
      "wine-prefixes",
      GAME_OBJECT_ID
    );
    const launchEnv = {
      GAMEID: `umu-${GAME_OBJECT_ID}`,
      WINEPREFIX: winePrefixPath,
      PROTONPATH: installedProtonPath,
      ...toggles.env,
      ...resolvedLaunchCommand.env,
    };
    assert.deepEqual(launchEnv, {
      GAMEID: `umu-${GAME_OBJECT_ID}`,
      WINEPREFIX: winePrefixPath,
      PROTONPATH: installedProtonPath,
      DXVK_ASYNC: "0",
      MANGOHUD: "0",
    });

    // The direct-Proton emergency fallback (proton-launcher.ts
    // l.315-320): `<protonPath>/proton waitforexitandrun <exe>`.
    const protonCommand = resolveLaunchCommand({
      baseCommand: path.join(installedProtonPath, "proton"),
      baseArgs: ["waitforexitandrun", GAME_EXE, "--windowed"],
      launchOptions: null,
      wrapperCommands: [],
    });
    assert.deepEqual(protonCommand, {
      command: path.join(installedProtonPath, "proton"),
      args: ["waitforexitandrun", GAME_EXE, "--windowed"],
      env: {},
    });

    // The direct-Proton env (proton-launcher.ts buildProtonEnv
    // l.129-145, composed here because the module is Electron-bound):
    // the full STEAM_COMPAT_* set for our game, SteamAppId/SteamGameId
    // gated to numeric ids (a custom uuid resolves to "0"), the legacy
    // MANGOHUD=1, then the flag env and the user's free-text env spread
    // in that order — the user still wins (proton-launcher.ts
    // l.346-352).
    const steamRoot = path.join(homeDir, ".local", "share", "Steam");
    const resolveCompatDataPath = (prefix: string): string =>
      path.basename(prefix).toLowerCase() === "pfx"
        ? path.dirname(prefix)
        : prefix;
    // The legacy useMangohud toggle contributes MANGOHUD=1 exactly like
    // buildProtonEnv's `...(options.useMangohud ? { MANGOHUD: "1" } : {})`.
    const useMangohud = true;
    const protonEnv = {
      STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
      STEAM_COMPAT_DATA_PATH: resolveCompatDataPath(winePrefixPath),
      STEAM_COMPAT_PREFIX_PATH: winePrefixPath,
      STEAM_COMPAT_INSTALL_PATH: path.dirname(GAME_EXE),
      SteamAppId: /^\d+$/.test(GAME_OBJECT_ID) ? GAME_OBJECT_ID : "0",
      SteamGameId: /^\d+$/.test(GAME_OBJECT_ID) ? GAME_OBJECT_ID : "0",
      ...(useMangohud ? { MANGOHUD: "1" } : {}),
      ...toggles.env,
      ...resolvedLaunchCommand.env,
    };
    assert.deepEqual(protonEnv, {
      STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
      STEAM_COMPAT_DATA_PATH: winePrefixPath,
      STEAM_COMPAT_PREFIX_PATH: winePrefixPath,
      STEAM_COMPAT_INSTALL_PATH: "/opt/hytale/install/release/package/game",
      SteamAppId: "0",
      SteamGameId: "0",
      MANGOHUD: "0",
      DXVK_ASYNC: "0",
    });

    // A Steam compatdata prefix keeps the DATA_PATH/PREFIX_PATH pair
    // consistent even for old Proton builds (proton-launcher.ts
    // resolveCompatDataPath l.80-85).
    const compatdataPrefix = path.join(
      root,
      "compatdata",
      GAME_OBJECT_ID,
      "pfx"
    );
    assert.equal(
      resolveCompatDataPath(compatdataPrefix),
      path.join(root, "compatdata", GAME_OBJECT_ID)
    );
  });
});
