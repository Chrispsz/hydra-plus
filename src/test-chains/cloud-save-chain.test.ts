/**
 * CHAIN D — "a custom save path from the user's disk to Google Drive and
 * back".
 *
 * One continuous scenario per sub-test: the folder the user picked is
 * canonicalized into a portable token, registered as the game's save rule,
 * validated into the Drive-side restore manifest, gated by the per-game
 * automatic-sync preference, and finally restored: the downloaded blob is
 * hash-checked against the manifest, its replacement target is contained
 * inside the decoded save root, and the bytes come back to the user's
 * disk.
 *
 * Stage map:
 *   1. TOKENS      canonicalizeSelectedCloudSaveCustomPath + encodeCloud-
 *                  SaveCustomPath + decodeCloudSaveCustomPath (custom-
 *                  path.ts) over the real Hytale matrix: a Windows
 *                  %APPDATA% path (pure encode/decode — the fake Windows
 *                  layout cannot go through the real stat/realpath shell
 *                  on this box), a native Linux <xdgData> path and the
 *                  real flatpak shape ~/.var/app/com.hypixel.Hytale-
 *                  Launcher/data/Hytale/UserData/Saves (full real shell).
 *   2. RULE        the canonicalized custom path becomes a CloudSaveRule
 *                  with source "custom".
 *   3. CONTRACT    the Drive layout contract: the restore manifest under
 *                  games/custom/<uuid>/manifest.json (cloud-save-
 *                  contract.ts validateRestoreManifest + validateRestore-
 *                  DownloadUrls + validateCustomPathRawPaths), with the
 *                  file hash computed from the real on-disk save bytes.
 *   4. ELIGIBILITY isCloudSaveV2Eligible + hasCloudSaveExecutableSelection
 *                  (@shared) + the stored-mode resolution chain
 *                  (automatic-sync-mode.ts) that the per-game preference
 *                  gate consumes.
 *   5. RESTORE     the downloaded blob is verified against the manifest
 *                  hash, selected and threaded into a replacement
 *                  (restore-replacements.ts), its target is contained
 *                  inside the decoded save root (is-within.ts) and
 *                  ambiguous/colliding targets are blocked (restore-
 *                  target-collision.ts).
 *
 * Headless boundaries (honesty over coverage theater):
 *   - custom-path-store.ts (customPathToCloudSaveRule) imports the live
 *     classic-level db at module load (src/main/level/level.ts constructs
 *     `new ClassicLevel(...)` eagerly), so the rule mapping is replayed
 *     from its documented contract and flagged for extraction into a
 *     pure module — the store itself is faked nowhere here because the
 *     chain only needs the mapping, not the persistence.
 *   - The Drive layout path constants (root folder name "Hydra Plus
 *     Saves", games/<shop>/<objectId>/manifest.json, blobs/<sha256>.blob)
 *     live in google-drive-store.ts / drive-client.ts, both of which are
 *     Electron/LevelDB-bound; the paths are composed from the documented
 *     layout comment (google-drive-store.ts l.52-71) while the manifest
 *     itself is validated by the REAL contract module.
 *   - verifyDownloadedRestoreFile / replaceRestoreTargets / resolveRestore-
 *     Targets are one-line adapters over the native addon (Electron `app`
 *     + the .node binary), so the hash check is replayed with REAL
 *     node:crypto against the documented VerifyDownloadedRestoreFileResult
 *     contract ({ ok: true } | { ok: false, reason: "hash_mismatch" }),
 *     and the target-containment links are asserted at their pure TS
 *     guards: the manifest-level safe-relative-path rejection (the
 *     contract never lets a file escape its rule root) and the shared
 *     isWithin predicate; the native resolver's own escape reporting is
 *     represented by the "blocked-target-outside-root" taxonomy in the
 *     types and exercised through the real blockAmbiguousRestoreTargets.
 *   - canRunAutomaticCloudSaveSync (automatic-sync.ts) is LevelDB/Drive-
 *     token bound; its pure predicates are the eligibility + executable
 *     + stored-mode functions chained in stage 4 (the same split the
 *     external-games chain exercises from the import side — this chain
 *     drives them from the cloud/restore side).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import type {
  CloudSaveCustomPath,
  CloudSaveRule,
  GameShop,
  ResolvedRestoreTarget,
  RestoreManifestResponse,
  SnapshotFile,
} from "@types";
import {
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  decodeCloudSaveCustomPath,
  encodeCloudSaveCustomPath,
  type CloudSaveCustomPathContext,
} from "../main/services/cloud-save/custom-path.js";
import {
  CLOUD_SAVE_HASH_PATTERN,
  cloudSaveFileKey,
  validateCustomPathRawPaths,
  validateRestoreDownloadUrls,
  validateRestoreManifest,
} from "../main/services/cloud-save/cloud-save-contract.js";
import {
  hasCloudSaveExecutableSelection,
  isCloudSaveV2Eligible,
} from "../shared/cloud-save-v2-eligibility.js";
import {
  resolveStoredCloudSaveAutomaticSyncMode,
  shouldRunV2AutomaticCloudSave,
} from "../main/services/cloud-save/automatic-sync-mode.js";
import {
  buildRestoreReplacements,
  isRestoreReplacementSuccessful,
  selectRestoreFiles,
} from "../main/services/cloud-save/restore-replacements.js";
import { blockAmbiguousRestoreTargets } from "../main/services/cloud-save/restore-target-collision.js";
import { inferCustomPathKind } from "../main/services/cloud-save/custom-path-kind.js";
import { isWithin } from "../main/helpers/is-within.js";

const posix = path.posix.join;
const win = path.win32.join;

const OBJECT_ID = "9f8b7c6d-5e4f-4a3b-9c2d-0e9f8a7b6c5d";
const WORLD_BYTES = Buffer.from("hytale save bytes — emerald world slot 1\n");

const sha256Hex = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Mirror of customPathToCloudSaveRule (custom-path-store.ts l.291-303).
 * The module cannot be imported here: it loads the classic-level db
 * eagerly (see the boundaries note above), so the chain replays the
 * documented mapping — a candidate for extraction into a pure module.
 */
const customPathToCloudSaveRule = (
  customPath: CloudSaveCustomPath
): CloudSaveRule => ({
  ruleId: `custom-${sha256Hex(customPath.rawPath)}`,
  kind: customPath.kind ?? "dir",
  rawPath: customPath.rawPath,
  source: "custom",
  tags: ["save"],
  when: [{ os: customPath.platform }],
  preferredPath: customPath.path,
});

/**
 * Mirror of the verify-downloaded-restore-file contract
 * (verify-downloaded-restore-file.ts delegates to the Electron-bound
 * native addon): sha256 of the downloaded blob against the manifest hash,
 * with the documented result shape.
 */
const verifyDownloadedRestoreFile = (
  tempPath: string,
  expectedHash: string
): { ok: true } | { ok: false; reason: "hash_mismatch" } =>
  sha256Hex(fs.readFileSync(tempPath)) === expectedHash
    ? { ok: true }
    : { ok: false, reason: "hash_mismatch" };

const tempRoots: string[] = [];

const createTempRoot = async (): Promise<string> => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hydra-chain-d-"));
  tempRoots.push(root);
  return fs.realpathSync(root);
};

after(async () => {
  await Promise.all(
    tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true }))
  );
});

describe("chain D — a custom save path from the user's disk to Google Drive and back", () => {
  it("scenario 1: the picked folder becomes a portable token on every platform of the Hytale matrix", async () => {
    const homeDir = await createTempRoot();

    // The real Linux path context the launch/cloud pipeline derives from
    // the game record (cloudSaveCustomPathContextFromPathContext builds
    // xdgDataDir = <home>/.local/share exactly like production).
    const context: CloudSaveCustomPathContext =
      cloudSaveCustomPathContextFromPathContext({
        platform: "linux",
        homeDir,
        executablePath: undefined,
        winePrefixPath: undefined,
        steamPath: undefined,
        objectId: OBJECT_ID,
        storeUserContext: { known: [] },
      });
    assert.equal(
      context.xdgDataDir,
      posix(homeDir, ".local", "share"),
      "the Linux context derives the XDG data root"
    );

    // The user's disk: a native Linux install plus the flatpak layout
    // from the external-games matrix, with a real save file inside.
    const nativeSaves = posix(
      homeDir,
      ".local",
      "share",
      "Hytale",
      "UserData",
      "Saves"
    );
    const flatpakSaves = posix(
      homeDir,
      ".var",
      "app",
      "com.hypixel.HytaleLauncher",
      "data",
      "Hytale",
      "UserData",
      "Saves"
    );
    const settingsFile = posix(
      homeDir,
      ".local",
      "share",
      "Hytale",
      "Settings.json"
    );
    await fsp.mkdir(posix(nativeSaves, "NativeWorld"), { recursive: true });
    await fsp.mkdir(flatpakSaves, { recursive: true });
    await fsp.writeFile(
      posix(nativeSaves, "NativeWorld", "world1.dat"),
      WORLD_BYTES
    );
    await fsp.writeFile(settingsFile, '{"patchline":"release"}');
    await fsp.writeFile(posix(flatpakSaves, "preview.png"), "png");

    // -- stage 1 (Linux legs): the FULL canonicalization shell ------------
    // (real stat + realpath + symlink guard) for the flatpak saves folder
    // and the native XDG saves folder.
    const flatpakPath = await canonicalizeSelectedCloudSaveCustomPath(
      flatpakSaves,
      context
    );
    assert.equal(
      flatpakPath.rawPath,
      `<custom><linux><home>${flatpakSaves.slice(homeDir.length)}`
    );
    assert.equal(flatpakPath.kind, "dir");
    assert.equal(flatpakPath.platform, "linux");

    const nativePath = await canonicalizeSelectedCloudSaveCustomPath(
      nativeSaves,
      context
    );
    assert.equal(
      nativePath.rawPath,
      "<custom><linux><xdgData>/Hytale/UserData/Saves"
    );

    const settingsCustomPath = await canonicalizeSelectedCloudSaveCustomPath(
      settingsFile,
      context,
      "file"
    );
    assert.equal(
      settingsCustomPath.rawPath,
      "<custom><linux><xdgData>/Hytale/Settings.json"
    );
    assert.equal(settingsCustomPath.kind, "file");

    // -- stage 1 (roundtrip): the token form decodes back to the exact
    // absolute paths the user picked (the decoded binding is what the
    // restore leg later resolves targets against).
    for (const customPath of [flatpakPath, nativePath, settingsCustomPath]) {
      const decoded = decodeCloudSaveCustomPath(customPath.rawPath, context);
      assert.equal(decoded.platform, "linux");
      assert.equal(decoded.path, customPath.path);
      assert.equal(decoded.rawPath, customPath.rawPath);
    }
    assert.equal(
      decodeCloudSaveCustomPath(flatpakPath.rawPath, context).path,
      flatpakSaves
    );
    assert.equal(
      decodeCloudSaveCustomPath(nativePath.rawPath, context).path,
      nativeSaves
    );

    // -- stage 1 (Windows leg): %APPDATA% becomes <winAppData>. The fake
    // Windows layout cannot go through the real stat shell on a Linux
    // box, so this leg chains the pure encode/decode core (the same
    // boundary the external-games chain documents for its import stage).
    const windowsContext: CloudSaveCustomPathContext =
      cloudSaveCustomPathContextFromPathContext({
        platform: "windows",
        homeDir: "C:\\Users\\Tester",
        documentsDir: win("C:\\Users\\Tester", "Documents"),
        appDataDir: "C:\\Users\\Tester\\AppData\\Roaming",
        executablePath: "C:\\Games\\Hytale\\HytaleClient.exe",
        winePrefixPath: undefined,
        steamPath: undefined,
        objectId: OBJECT_ID,
        storeUserContext: { known: [] },
      });
    const windowsSaves = win(
      "C:\\Users\\Tester\\AppData\\Roaming",
      "Hytale",
      "UserData",
      "Saves"
    );
    const windowsCustomPath = encodeCloudSaveCustomPath(
      windowsSaves,
      windowsContext
    );
    assert.equal(
      windowsCustomPath.rawPath,
      "<custom><windows><winAppData>/Hytale/UserData/Saves"
    );
    assert.equal(windowsCustomPath.platform, "windows");
    const windowsDecoded = decodeCloudSaveCustomPath(
      windowsCustomPath.rawPath,
      windowsContext
    );
    assert.equal(windowsDecoded.path, windowsCustomPath.path);
    assert.equal(
      windowsDecoded.path,
      "C:/Users/Tester/AppData/Roaming/Hytale/UserData/Saves"
    );

    // A protected path (the Windows directory) never becomes a token.
    assert.throws(
      () => encodeCloudSaveCustomPath("C:\\Windows\\System32", windowsContext),
      /cloud_save_custom_path_protected/
    );
  });

  it("scenario 2: the token becomes a save rule and a Drive manifest entry for the custom game", async () => {
    const homeDir = await createTempRoot();
    const context: CloudSaveCustomPathContext =
      cloudSaveCustomPathContextFromPathContext({
        platform: "linux",
        homeDir,
        executablePath: undefined,
        winePrefixPath: undefined,
        steamPath: undefined,
        objectId: OBJECT_ID,
        storeUserContext: { known: [] },
      });

    const flatpakSaves = posix(
      homeDir,
      ".var",
      "app",
      "com.hypixel.HytaleLauncher",
      "data",
      "Hytale",
      "UserData",
      "Saves"
    );
    await fsp.mkdir(flatpakSaves, { recursive: true });
    await fsp.writeFile(posix(flatpakSaves, "world1.dat"), WORLD_BYTES);

    const flatpakPath = await canonicalizeSelectedCloudSaveCustomPath(
      flatpakSaves,
      context
    );

    // -- stage 2: RULE --------------------------------------------------------
    // The rule the native resolver receives: source "custom", the token
    // rawPath, the locally bound preferred path, tagged as a save with the
    // platform condition. ruleId is derived from the rawPath.
    const rule = customPathToCloudSaveRule(flatpakPath);
    assert.equal(rule.kind, "dir");
    assert.equal(rule.source, "custom");
    assert.deepEqual(rule.tags, ["save"]);
    assert.deepEqual(rule.when, [{ os: "linux" }]);
    assert.equal(rule.rawPath, flatpakPath.rawPath);
    assert.equal(rule.preferredPath, flatpakSaves);
    assert.equal(rule.ruleId, `custom-${sha256Hex(flatpakPath.rawPath)}`);
    // The rule carries exactly the fields the resolver input contract
    // picks (ResolveRestoreTargetsInput.approvedRules).
    assert.deepEqual(
      {
        kind: rule.kind,
        rawPath: rule.rawPath,
        source: rule.source,
        preferredPath: rule.preferredPath,
        when: rule.when,
      },
      {
        kind: "dir",
        rawPath: flatpakPath.rawPath,
        source: "custom",
        preferredPath: flatpakSaves,
        when: [{ os: "linux" }],
      }
    );

    // -- stage 3: CONTRACT ----------------------------------------------------
    // The Drive layout (google-drive-store.ts l.52-71): everything lives
    // under "Hydra Plus Saves/", per-game manifests under
    // games/<shop>/<objectId>/ and content-addressed blobs under
    // blobs/<sha256>.blob. The manifest hash is the REAL sha256 of the
    // user's save bytes from scenario 1's disk.
    const worldHash = sha256Hex(WORLD_BYTES);
    assert.match(worldHash, CLOUD_SAVE_HASH_PATTERN);
    const variantId = sha256Hex("variant-default");
    const worldFile: SnapshotFile = {
      variantId,
      rawPath: flatpakPath.rawPath,
      relativePath: "world1.dat",
      hash: worldHash,
      sizeBytes: WORLD_BYTES.length,
      lastModifiedAt: "2026-07-20T10:00:00.000Z",
    };
    // The raw manifest omits customPathRawPaths on purpose: the contract
    // derives the active custom paths from the file list, and the chain
    // proves that derivation below.
    const manifest = {
      snapshot: {
        id: "snap-2026-07-20",
        version: 1,
        shop: "custom",
        objectId: OBJECT_ID,
      },
      variants: [{ variantId, kind: "default" }],
      files: [worldFile],
    };
    assert.equal(
      cloudSaveFileKey(worldFile),
      JSON.stringify([variantId, flatpakPath.rawPath, "world1.dat"])
    );

    const validated: RestoreManifestResponse =
      validateRestoreManifest(manifest);
    assert.equal(validated.snapshot.shop, "custom");
    assert.equal(validated.snapshot.objectId, OBJECT_ID);
    assert.deepEqual(validated.files, [worldFile]);
    // The active custom paths default to every custom rawPath the files
    // reference — our token round-trips through the manifest untouched.
    assert.deepEqual(validated.customPathRawPaths, [flatpakPath.rawPath]);
    assert.deepEqual(validateCustomPathRawPaths(validated.customPathRawPaths), [
      flatpakPath.rawPath,
    ]);
    assert.throws(
      () => validateCustomPathRawPaths(["/plain/absolute/path"]),
      /Invalid Cloud Save custom path/
    );
    assert.throws(
      () =>
        validateCustomPathRawPaths([flatpakPath.rawPath, flatpakPath.rawPath]),
      /Duplicate Cloud Save custom path/
    );

    // The Drive-side paths of the manifest and its blob, composed from
    // the documented layout (the store modules are Electron-bound).
    assert.equal(
      posix("Hydra Plus Saves", "games", "custom", OBJECT_ID, "manifest.json"),
      `Hydra Plus Saves/games/custom/${OBJECT_ID}/manifest.json`
    );
    assert.equal(
      posix("Hydra Plus Saves", "blobs", `${worldHash}.blob`),
      `Hydra Plus Saves/blobs/${worldHash}.blob`
    );

    // The manifest rejects the unsupported shop: the Drive engine covers
    // steam + custom only (cloud-save-contract.ts l.326).
    assert.throws(
      () =>
        validateRestoreManifest({
          ...manifest,
          snapshot: {
            id: "snap-2026-07-20",
            version: 1,
            shop: "launchbox" as GameShop,
            objectId: OBJECT_ID,
          },
        }),
      /Invalid restore manifest snapshot/
    );

    // Escape attempts never make it into a manifest: every relative path
    // is validated to be a safe, root-relative path (the first pure
    // containment guard of the restore pipeline).
    for (const escape of [
      "../../evil.dat",
      "..\\evil.dat",
      "/etc/passwd",
      "C:\\evil.dat",
      "C:evil.dat",
    ]) {
      assert.throws(
        () =>
          validateRestoreManifest({
            ...manifest,
            files: [{ ...worldFile, relativePath: escape }],
          }),
        /Invalid Cloud Save snapshot file/,
        `relativePath ${escape} must be rejected`
      );
    }

    // The download URLs the Drive store hands out are validated against
    // the same file contract with an http(s) requirement.
    const downloadUrls = validateRestoreDownloadUrls([
      {
        ...worldFile,
        downloadUrl: `https://drive.google.com/blobs/${worldHash}`,
      },
    ]);
    assert.deepEqual(downloadUrls, [
      {
        ...worldFile,
        downloadUrl: `https://drive.google.com/blobs/${worldHash}`,
      },
    ]);
    assert.throws(
      () =>
        validateRestoreDownloadUrls([
          { ...worldFile, downloadUrl: "ftp://drive.google.com/blob" },
        ]),
      /Invalid restore download URL file/
    );
  });

  it("scenario 3: the game is opted in, the snapshot comes back verified and contained", async () => {
    const homeDir = await createTempRoot();
    const context: CloudSaveCustomPathContext =
      cloudSaveCustomPathContextFromPathContext({
        platform: "linux",
        homeDir,
        executablePath: undefined,
        winePrefixPath: undefined,
        steamPath: undefined,
        objectId: OBJECT_ID,
        storeUserContext: { known: [] },
      });

    const flatpakSaves = posix(
      homeDir,
      ".var",
      "app",
      "com.hypixel.HytaleLauncher",
      "data",
      "Hytale",
      "UserData",
      "Saves"
    );
    await fsp.mkdir(flatpakSaves, { recursive: true });
    await fsp.writeFile(posix(flatpakSaves, "world1.dat"), WORLD_BYTES);

    const flatpakPath = await canonicalizeSelectedCloudSaveCustomPath(
      flatpakSaves,
      context
    );
    const worldHash = sha256Hex(WORLD_BYTES);
    const variantId = sha256Hex("variant-default");
    const worldFile: SnapshotFile = {
      variantId,
      rawPath: flatpakPath.rawPath,
      relativePath: "world1.dat",
      hash: worldHash,
      sizeBytes: WORLD_BYTES.length,
      lastModifiedAt: "2026-07-20T10:00:00.000Z",
    };
    const manifest = validateRestoreManifest({
      snapshot: {
        id: "snap-2026-07-20",
        version: 1,
        shop: "custom",
        objectId: OBJECT_ID,
      },
      variants: [{ variantId, kind: "default" }],
      files: [worldFile],
    });

    // -- stage 4: ELIGIBILITY -------------------------------------------------
    // The cloud side of the gate: only steam and custom are v2-eligible,
    // and only a game with an executable participates (the pre-launch
    // restore needs something to launch afterwards).
    assert.equal(isCloudSaveV2Eligible("custom"), true);
    assert.equal(isCloudSaveV2Eligible("steam"), true);
    assert.equal(isCloudSaveV2Eligible("launchbox"), false);
    const game = {
      shop: "custom" as GameShop,
      platform: "linux",
      executablePath: "/home/tester/.local/bin/hytale-launcher",
      automaticCloudSync: false,
    };
    assert.equal(
      hasCloudSaveExecutableSelection(game),
      true,
      "the imported game has an executable to launch"
    );
    assert.equal(
      hasCloudSaveExecutableSelection({ ...game, executablePath: null }),
      false
    );

    // The per-game preference gate (automatic-sync-settings.ts reads the
    // stored v2 flag with the legacy record flag as fallback; the pure
    // resolution is resolveStoredCloudSaveAutomaticSyncMode). A fresh
    // custom game ships with automaticCloudSync false and no stored
    // flag → disabled until the user opts in (the wizard's checkbox).
    const modeFor = (
      automaticCloudSync: boolean,
      storedV2Enabled: boolean | undefined
    ) =>
      shouldRunV2AutomaticCloudSave(
        resolveStoredCloudSaveAutomaticSyncMode(
          automaticCloudSync,
          storedV2Enabled
        )
      );
    assert.equal(modeFor(false, undefined), false);
    assert.equal(
      modeFor(false, true),
      true,
      "the wizard opt-in enables the v2 lifecycle"
    );
    assert.equal(
      modeFor(true, undefined),
      true,
      "a legacy-enabled record migrates to v2 on read"
    );
    assert.equal(
      modeFor(true, false),
      false,
      "an explicit opt-out wins over the legacy flag"
    );

    // -- stage 5: RESTORE -------------------------------------------------------
    // "And back": the blob Drive served for world1.dat lands in a temp
    // file (downloadRestoreBlobToTemp is native; the chain stages the
    // downloaded artifact directly).
    const downloadsDir = path.join(homeDir, "restore-temp");
    await fsp.mkdir(downloadsDir, { recursive: true });
    const downloadedBlobPath = path.join(
      downloadsDir,
      `${manifest.snapshot.id}-v${manifest.snapshot.version}`,
      `${worldHash}.blob`
    );
    await fsp.mkdir(path.dirname(downloadedBlobPath), { recursive: true });
    await fsp.writeFile(downloadedBlobPath, WORLD_BYTES);

    // Hash validation seam (REAL node:crypto): the matching blob passes,
    // a tampered byte is rejected with the documented hash_mismatch.
    assert.deepEqual(
      verifyDownloadedRestoreFile(downloadedBlobPath, worldHash),
      {
        ok: true,
      }
    );
    const tamperedBlobPath = path.join(downloadsDir, "tampered.blob");
    await fsp.writeFile(
      tamperedBlobPath,
      Buffer.concat([
        WORLD_BYTES.subarray(0, 3),
        Buffer.from("X"),
        WORLD_BYTES.subarray(4),
      ])
    );
    assert.deepEqual(verifyDownloadedRestoreFile(tamperedBlobPath, worldHash), {
      ok: false,
      reason: "hash_mismatch",
    });

    // The entry is selected by its manifest identity and threaded into a
    // replacement whose target is the DECODED save root from stage 1 —
    // the local binding the restore resolves against.
    const entryId = cloudSaveFileKey(manifest.files[0]);
    assert.deepEqual(
      selectRestoreFiles(manifest.files, [entryId]),
      manifest.files
    );
    assert.throws(
      () => selectRestoreFiles(manifest.files, ["missing-entry"]),
      /Requested restore file is missing from manifest/
    );

    const restoreRootPath = decodeCloudSaveCustomPath(
      flatpakPath.rawPath,
      context
    ).path;
    const resolvedTarget: ResolvedRestoreTarget = {
      ...manifest.files[0],
      targetPath: posix(restoreRootPath, "world1.dat"),
      restoreRootPath,
      action: "replace",
    };
    const replacements = buildRestoreReplacements(
      [resolvedTarget],
      [{ ...manifest.files[0], tempPath: downloadedBlobPath }]
    );
    assert.deepEqual(replacements, [
      {
        variantId,
        rawPath: flatpakPath.rawPath,
        relativePath: "world1.dat",
        targetPath: posix(restoreRootPath, "world1.dat"),
        restoreRootPath,
        lastModifiedAt: "2026-07-20T10:00:00.000Z",
        action: "restore",
        tempPath: downloadedBlobPath,
        expectedHash: worldHash,
      },
    ]);

    // The user's bytes survived the whole trip: the verified blob equals
    // the file that was originally picked up from disk.
    assert.deepEqual(
      await fsp.readFile(
        replacements[0].action === "restore"
          ? replacements[0].tempPath
          : downloadedBlobPath
      ),
      WORLD_BYTES
    );

    // Containment: the replacement target lives inside its restore root;
    // an escape attempt resolving outside the root is rejected by the
    // same symlink-aware predicate the launcher uses elsewhere
    // (is-within.ts), and the manifest contract already refused the
    // escaping relativePaths at the source (scenario 2).
    assert.equal(
      isWithin(
        replacements[0].action === "restore"
          ? replacements[0].targetPath
          : resolvedTarget.targetPath,
        restoreRootPath
      ),
      true
    );
    assert.equal(
      isWithin(
        path.join(restoreRootPath, "..", "..", "evil.dat"),
        restoreRootPath
      ),
      false,
      "a target resolving outside the restore root is not contained"
    );

    // Two variants resolving to the same on-disk target are both blocked
    // by the real ambiguity guard (the native resolver reports
    // blocked-target-* and the collision module blocks the rest).
    const ambiguousTarget: ResolvedRestoreTarget = {
      ...resolvedTarget,
      variantId: sha256Hex("variant-second"),
      relativePath: "world1.dat",
    };
    const blockedPlan = blockAmbiguousRestoreTargets(
      { actions: [resolvedTarget, ambiguousTarget], blocked: [], deferred: [] },
      true
    );
    assert.equal(blockedPlan.actions.length, 0);
    assert.deepEqual(
      blockedPlan.blocked.map((blocked) => blocked.reason),
      ["blocked-target-ambiguous", "blocked-target-ambiguous"]
    );

    // The restored custom paths re-register with an inferred kind: a
    // lone known save file rebinds as a file path, everything else stays
    // a directory (custom-path-kind.ts — the restore leg of the store).
    assert.equal(
      inferCustomPathKind(
        "<custom><linux><home>/.var/app/com.hypixel.HytaleLauncher/data/Hytale/UserData/Saves/world.sav",
        [{ relativePath: "world.sav" }],
        { shop: "custom", platform: "linux" }
      ),
      "file"
    );
    assert.equal(
      inferCustomPathKind(flatpakPath.rawPath, manifest.files, {
        shop: "custom",
        platform: "linux",
        storedKind: "dir",
      }),
      "dir"
    );

    // Replacement accounting: a complete restore with only metadata
    // failures still counts as success; a missing file never does.
    assert.equal(
      isRestoreReplacementSuccessful(
        {
          restoredFiles: [
            {
              variantId,
              rawPath: flatpakPath.rawPath,
              relativePath: "world1.dat",
              targetPath: posix(restoreRootPath, "world1.dat"),
              restoreRootPath,
              lastModifiedAt: "2026-07-20T10:00:00.000Z",
            },
          ],
          skippedFiles: [],
          failedFiles: [],
          metadataFailures: [
            {
              path: restoreRootPath,
              kind: "directory",
              reason: "failed-to-set-mtime",
            },
          ],
          updatedDirectoryCount: 1,
        },
        1
      ),
      true
    );
    assert.equal(
      isRestoreReplacementSuccessful(
        {
          restoredFiles: [],
          skippedFiles: [],
          failedFiles: [],
          metadataFailures: [],
          updatedDirectoryCount: 0,
        },
        1
      ),
      false
    );
  });
});
