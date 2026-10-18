import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  PREVIOUS_DIR_PREFIX,
  STAGING_DIR_PREFIX,
  inspectStagedProton,
  isValidProtonDirectory,
  promoteStagedProton,
  createStagingDir,
  writeProtonMetadata,
  type ProtonInstallMetadata,
} from "./install-transaction.ts";

const roots: string[] = [];

const createRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-proton-promote-")
  );
  roots.push(root);
  return root;
};

const createProtonBuild = async (directoryPath: string) => {
  await fs.promises.mkdir(directoryPath, { recursive: true });
  await fs.promises.writeFile(
    path.join(directoryPath, "proton"),
    "#!/bin/sh\n"
  );
  await fs.promises.writeFile(
    path.join(directoryPath, "toolmanifest.vdf"),
    '"manifest"\n'
  );
};

const metadata: ProtonInstallMetadata = {
  provider: "ge-proton",
  tag: "GE-Proton9-20",
  assetName: "GE-Proton9-20.tar.gz",
  installedAt: "2024-10-01T00:00:00.000Z",
};

after(async () => {
  await Promise.all(
    roots.map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe("isValidProtonDirectory", () => {
  it("requires proton and toolmanifest.vdf", async () => {
    const root = await createRoot();
    const complete = path.join(root, "complete");
    await createProtonBuild(complete);
    assert.equal(isValidProtonDirectory(complete), true);

    const missingManifest = path.join(root, "missing-manifest");
    await fs.promises.mkdir(missingManifest);
    await fs.promises.writeFile(path.join(missingManifest, "proton"), "");
    assert.equal(isValidProtonDirectory(missingManifest), false);
  });
});

describe("inspectStagedProton", () => {
  it("accepts a staging directory with exactly one valid Proton root", async () => {
    const root = await createRoot();
    const stagingDir = path.join(root, STAGING_DIR_PREFIX + "abc123");
    await createProtonBuild(path.join(stagingDir, "GE-Proton9-20"));

    assert.deepEqual(inspectStagedProton(stagingDir), {
      releaseDirName: "GE-Proton9-20",
    });
  });

  it("rejects multi-entry and non-Proton staging directories", async () => {
    const root = await createRoot();

    const twoEntries = path.join(root, "two");
    await createProtonBuild(path.join(twoEntries, "a"));
    await fs.promises.mkdir(path.join(twoEntries, "b"));
    assert.throws(
      () => inspectStagedProton(twoEntries),
      /proton_invalid_archive_layout/
    );

    const plainDir = path.join(root, "plain");
    await fs.promises.mkdir(path.join(plainDir, "not-proton"), {
      recursive: true,
    });
    assert.throws(
      () => inspectStagedProton(plainDir),
      /proton_invalid_archive_layout/
    );

    const fileRoot = path.join(root, "file");
    await fs.promises.mkdir(fileRoot);
    await fs.promises.writeFile(path.join(fileRoot, "archive.txt"), "");
    assert.throws(
      () => inspectStagedProton(fileRoot),
      /proton_invalid_archive_layout/
    );
  });
});

describe("createStagingDir", () => {
  it("creates the staging directory in the target parent", async () => {
    const root = await createRoot();
    const targetDir = path.join(root, "compatibilitytools.d");

    const stagingDir = await createStagingDir(targetDir);

    assert.equal(path.dirname(stagingDir), path.dirname(targetDir));
    assert.match(path.basename(stagingDir), /^\.hydra-proton-stage-/);
    assert.equal(fs.existsSync(stagingDir), true);
  });
});

describe("promoteStagedProton", () => {
  it("moves the staged build into the target and writes metadata", async () => {
    const root = await createRoot();
    const targetDir = path.join(root, "compatibilitytools.d");
    const stagingDir = path.join(root, STAGING_DIR_PREFIX + "aaa");
    await createProtonBuild(path.join(stagingDir, "GE-Proton9-20"));

    await promoteStagedProton({
      stagingDir,
      releaseDirName: "GE-Proton9-20",
      targetDir,
      metadata,
    });

    const installedDir = path.join(targetDir, "GE-Proton9-20");
    assert.equal(isValidProtonDirectory(installedDir), true);

    const writtenMetadata = JSON.parse(
      await fs.promises.readFile(
        path.join(installedDir, ".hydra-proton.json"),
        "utf8"
      )
    ) as ProtonInstallMetadata;
    assert.deepEqual(writtenMetadata, metadata);

    assert.equal(fs.existsSync(path.join(stagingDir, "GE-Proton9-20")), false);
  });

  it("replaces an existing build and removes the previous backup", async () => {
    const root = await createRoot();
    const targetDir = path.join(root, "compatibilitytools.d");
    await createProtonBuild(path.join(targetDir, "GE-Proton9-20"));
    await fs.promises.writeFile(
      path.join(targetDir, "GE-Proton9-20", "proton"),
      "old build"
    );

    const stagingDir = path.join(root, STAGING_DIR_PREFIX + "bbb");
    await createProtonBuild(path.join(stagingDir, "GE-Proton9-20"));

    await promoteStagedProton({
      stagingDir,
      releaseDirName: "GE-Proton9-20",
      targetDir,
      metadata,
      createSuffix: () => "feed42",
    });

    assert.equal(
      await fs.promises.readFile(
        path.join(targetDir, "GE-Proton9-20", "proton"),
        "utf8"
      ),
      "#!/bin/sh\n"
    );
    assert.equal(
      fs.existsSync(path.join(root, `${PREVIOUS_DIR_PREFIX}feed42`)),
      false
    );
  });

  it("restores the previous build when the promote rename fails", async () => {
    const root = await createRoot();
    const targetDir = path.join(root, "compatibilitytools.d");
    await createProtonBuild(path.join(targetDir, "GE-Proton9-20"));
    await fs.promises.writeFile(
      path.join(targetDir, "GE-Proton9-20", "proton"),
      "old build"
    );

    const stagingDir = path.join(root, STAGING_DIR_PREFIX + "ccc");
    await createProtonBuild(path.join(stagingDir, "GE-Proton9-20"));

    const failingRename: typeof fs.promises.rename = async (
      fromPath,
      toPath
    ) => {
      if (String(fromPath).startsWith(stagingDir)) {
        throw new Error("simulated cross-device rename failure");
      }
      return fs.promises.rename(fromPath, toPath);
    };

    await assert.rejects(
      () =>
        promoteStagedProton({
          stagingDir,
          releaseDirName: "GE-Proton9-20",
          targetDir,
          metadata,
          rename: failingRename,
        }),
      /simulated cross-device rename failure/
    );

    assert.equal(
      await fs.promises.readFile(
        path.join(targetDir, "GE-Proton9-20", "proton"),
        "utf8"
      ),
      "old build"
    );

    const leftovers = await fs.promises.readdir(root);
    assert.deepEqual(
      leftovers.filter((entry) => entry.startsWith(PREVIOUS_DIR_PREFIX)),
      []
    );
    assert.equal(
      isValidProtonDirectory(path.join(stagingDir, "GE-Proton9-20")),
      true
    );
  });

  it("does not leave a previous backup when the destination is new", async () => {
    const root = await createRoot();
    const targetDir = path.join(root, "compatibilitytools.d");
    const stagingDir = path.join(root, STAGING_DIR_PREFIX + "ddd");
    await createProtonBuild(path.join(stagingDir, "GE-Proton9-20"));

    const usedSuffixes: string[] = [];
    await promoteStagedProton({
      stagingDir,
      releaseDirName: "GE-Proton9-20",
      targetDir,
      metadata,
      createSuffix: () => {
        usedSuffixes.push("called");
        return "unused";
      },
    });

    assert.deepEqual(usedSuffixes, []);
  });
});

describe("writeProtonMetadata", () => {
  it("writes the provenance metadata as JSON", async () => {
    const root = await createRoot();
    const installedDir = path.join(root, "GE-Proton9-20");
    await createProtonBuild(installedDir);

    await writeProtonMetadata(installedDir, metadata);

    const raw = await fs.promises.readFile(
      path.join(installedDir, ".hydra-proton.json"),
      "utf8"
    );
    assert.deepEqual(JSON.parse(raw), metadata);
  });
});
