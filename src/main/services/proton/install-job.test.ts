import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";

import type { ProtonInstallProgress, ProtonRelease } from "@types";

import { runProtonInstallJob } from "./install-job.ts";
import { PROTON_METADATA_FILENAME } from "./install-transaction.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

const createRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-proton-job-")
  );
  roots.push(root);
  return root;
};

const createProtonSourceDir = async (parentDir: string) => {
  const sourceDir = path.join(parentDir, "GE-Proton9-20");
  await fs.promises.mkdir(sourceDir, { recursive: true });
  await fs.promises.writeFile(path.join(sourceDir, "proton"), "#!/bin/sh\n");
  await fs.promises.writeFile(
    path.join(sourceDir, "toolmanifest.vdf"),
    '"manifest"\n'
  );
  return sourceDir;
};

const createArchive = async (parentDir: string) => {
  const sourceDir = await createProtonSourceDir(parentDir);
  const archivePath = path.join(parentDir, "GE-Proton9-20.tar.gz");
  await execFileAsync("tar", [
    "-czf",
    archivePath,
    "-C",
    parentDir,
    path.basename(sourceDir),
  ]);

  const content = await fs.promises.readFile(archivePath);
  return {
    archivePath,
    sizeBytes: content.length,
    digest: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
  };
};

const makeRelease = (archive: {
  sizeBytes: number;
  digest: string;
}): ProtonRelease => ({
  tag: "GE-Proton9-20",
  name: "GE-Proton 9-20",
  publishedAt: "2024-10-01T00:00:00Z",
  sizeBytes: archive.sizeBytes,
  downloadUrl: "https://example.com/downloads/GE-Proton9-20.tar.gz",
  digest: archive.digest,
});

after(async () => {
  await Promise.all(
    roots.map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe("runProtonInstallJob", () => {
  it("runs the full pipeline and reports every phase", async () => {
    const root = await createRoot();
    const archive = await createArchive(root);
    const targetDir = path.join(root, "compatibilitytools.d");
    const workspaceDir = path.join(root, "workspace");

    const phases: ProtonInstallProgress["phase"][] = [];

    await runProtonInstallJob({
      providerId: "ge-proton",
      release: makeRelease(archive),
      targetDir,
      workspaceDir,
      deps: {
        downloadArchive: async ({ destinationPath, onProgress }) => {
          await fs.promises.copyFile(archive.archivePath, destinationPath);
          onProgress?.(archive.sizeBytes, archive.sizeBytes);
        },
        extractArchive: async ({ archivePath, destinationDir }) => {
          await execFileAsync("tar", [
            "-xf",
            archivePath,
            "-C",
            destinationDir,
          ]);
        },
      },
      signal: new AbortController().signal,
      onProgress: (payload) => phases.push(payload.phase),
    });

    assert.deepEqual(phases, [
      "downloading",
      "downloading",
      "verifying",
      "extracting",
      "promoting",
      "done",
    ]);

    const installedDir = path.join(targetDir, "GE-Proton9-20");
    assert.equal(fs.existsSync(path.join(installedDir, "proton")), true);
    assert.equal(
      fs.existsSync(path.join(installedDir, "toolmanifest.vdf")),
      true
    );

    const metadata = JSON.parse(
      await fs.promises.readFile(
        path.join(installedDir, PROTON_METADATA_FILENAME),
        "utf8"
      )
    );
    assert.equal(metadata.provider, "ge-proton");
    assert.equal(metadata.tag, "GE-Proton9-20");
    assert.equal(metadata.assetName, "GE-Proton9-20.tar.gz");
    assert.ok(metadata.installedAt);

    assert.equal(fs.existsSync(workspaceDir), false);
    const stagingLeftovers = (await fs.promises.readdir(root)).filter((entry) =>
      entry.startsWith(".hydra-proton-stage-")
    );
    assert.deepEqual(stagingLeftovers, []);
  });

  it("fails on digest mismatch and cleans up the workspace", async () => {
    const root = await createRoot();
    const archive = await createArchive(root);
    const targetDir = path.join(root, "compatibilitytools.d");
    const workspaceDir = path.join(root, "workspace");

    const tamperedRelease = {
      ...makeRelease(archive),
      digest: `sha256:${"0".repeat(64)}`,
    };

    await assert.rejects(
      () =>
        runProtonInstallJob({
          providerId: "ge-proton",
          release: tamperedRelease,
          targetDir,
          workspaceDir,
          deps: {
            downloadArchive: async ({ destinationPath }) => {
              await fs.promises.copyFile(archive.archivePath, destinationPath);
            },
            extractArchive: async () => {},
          },
          signal: new AbortController().signal,
          onProgress: () => {},
        }),
      /proton_verification_digest_mismatch/
    );

    assert.equal(fs.existsSync(workspaceDir), false);
    assert.equal(fs.existsSync(path.join(targetDir, "GE-Proton9-20")), false);
  });

  it("propagates cancellation and cleans up", async () => {
    const root = await createRoot();
    const targetDir = path.join(root, "compatibilitytools.d");
    const workspaceDir = path.join(root, "workspace");
    const controller = new AbortController();

    const downloadThatCancels = () =>
      new Promise<void>((_, reject) => {
        const onAbort = () => reject(new Error("canceled"));
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => reject(new Error("download never finished")), 2_000);
      });

    const jobPromise = runProtonInstallJob({
      providerId: "ge-proton",
      release: makeRelease({
        sizeBytes: 10,
        digest: `sha256:${"a".repeat(64)}`,
      }),
      targetDir,
      workspaceDir,
      deps: {
        downloadArchive: downloadThatCancels,
        extractArchive: async () => {},
      },
      signal: controller.signal,
      onProgress: () => {},
    });

    setTimeout(() => controller.abort(), 10);

    await assert.rejects(() => jobPromise, /canceled/);
    assert.equal(fs.existsSync(workspaceDir), false);
  });

  it("rejects archives whose staging layout is not a single Proton root", async () => {
    const root = await createRoot();
    const archivePath = path.join(root, "two-roots.tar.gz");

    const firstDir = path.join(root, "first");
    const secondDir = path.join(root, "second");
    await fs.promises.mkdir(path.join(firstDir, "nested"), { recursive: true });
    await fs.promises.mkdir(secondDir, { recursive: true });
    await fs.promises.writeFile(path.join(firstDir, "proton"), "");
    await fs.promises.writeFile(path.join(firstDir, "toolmanifest.vdf"), "");
    await execFileAsync("tar", [
      "-czf",
      archivePath,
      "-C",
      root,
      "first",
      "second",
    ]);

    const content = await fs.promises.readFile(archivePath);
    const release: ProtonRelease = {
      tag: "two-roots",
      name: "two-roots",
      publishedAt: "",
      sizeBytes: content.length,
      downloadUrl: "https://example.com/downloads/two-roots.tar.gz",
      digest: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
    };

    const targetDir = path.join(root, "compatibilitytools.d");
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
              await fs.promises.copyFile(archivePath, destinationPath);
            },
            extractArchive: async ({ archivePath: source, destinationDir }) => {
              await fs.promises.mkdir(destinationDir, { recursive: true });
              await execFileAsync("tar", ["-xf", source, "-C", destinationDir]);
            },
          },
          signal: new AbortController().signal,
          onProgress: () => {},
        }),
      /proton_invalid_archive_layout/
    );

    assert.equal(fs.existsSync(workspaceDir), false);
    const targetParentEntries = await fs.promises.readdir(root);
    assert.deepEqual(
      targetParentEntries.filter((entry) =>
        entry.startsWith(".hydra-proton-stage-")
      ),
      []
    );
  });
});
