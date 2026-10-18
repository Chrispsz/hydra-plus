import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";

import { extractProtonArchive } from "./archive-extraction.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

const createRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-proton-extract-")
  );
  roots.push(root);
  return root;
};

const createProtonSourceDir = async (parentDir: string) => {
  const sourceDir = path.join(parentDir, "GE-Proton9-20");
  await fs.promises.mkdir(path.join(sourceDir, "files"), { recursive: true });
  await fs.promises.writeFile(path.join(sourceDir, "proton"), "#!/bin/sh\n");
  await fs.promises.writeFile(
    path.join(sourceDir, "toolmanifest.vdf"),
    '"manifest"\n'
  );
  await fs.promises.writeFile(path.join(sourceDir, "files", "dist"), "payload");
  return sourceDir;
};

const isTarAvailable = async () => {
  try {
    await execFileAsync("tar", ["--version"]);
    return true;
  } catch {
    return false;
  }
};

after(async () => {
  await Promise.all(
    roots.map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

describe("extractProtonArchive", () => {
  it("extracts a tar.gz archive into the destination directory", async () => {
    if (!(await isTarAvailable())) return;

    const root = await createRoot();
    const sourceDir = await createProtonSourceDir(root);
    const archivePath = path.join(root, "archive.tar.gz");
    await execFileAsync("tar", [
      "-czf",
      archivePath,
      "-C",
      root,
      path.basename(sourceDir),
    ]);

    const destinationDir = path.join(root, "staging");
    await fs.promises.mkdir(destinationDir);

    await extractProtonArchive({
      archivePath,
      destinationDir,
      signal: new AbortController().signal,
    });

    assert.equal(
      await fs.promises.readFile(
        path.join(destinationDir, "GE-Proton9-20", "files", "dist"),
        "utf8"
      ),
      "payload"
    );
  });

  it("extracts a tar.xz archive through compression auto-detection", async () => {
    if (!(await isTarAvailable())) return;

    const root = await createRoot();
    const sourceDir = await createProtonSourceDir(root);
    const archivePath = path.join(root, "archive.tar.xz");
    await execFileAsync("tar", [
      "-cJf",
      archivePath,
      "-C",
      root,
      path.basename(sourceDir),
    ]);

    const destinationDir = path.join(root, "staging-xz");
    await fs.promises.mkdir(destinationDir);

    await extractProtonArchive({
      archivePath,
      destinationDir,
      signal: new AbortController().signal,
    });

    assert.equal(
      fs.existsSync(path.join(destinationDir, "GE-Proton9-20", "proton")),
      true
    );
  });

  it("reports a clear error for a corrupt archive", async () => {
    if (!(await isTarAvailable())) return;

    const root = await createRoot();
    const archivePath = path.join(root, "corrupt.tar.gz");
    await fs.promises.writeFile(archivePath, Buffer.from("not a tar archive"));

    const destinationDir = path.join(root, "staging-corrupt");
    await fs.promises.mkdir(destinationDir);

    await assert.rejects(
      () =>
        extractProtonArchive({
          archivePath,
          destinationDir,
          signal: new AbortController().signal,
        }),
      /proton_extraction_failed/
    );
  });

  it("rejects unsupported archive extensions before spawning", async () => {
    const root = await createRoot();

    await assert.rejects(
      () =>
        extractProtonArchive({
          archivePath: path.join(root, "build.rar"),
          destinationDir: path.join(root, "staging"),
          signal: new AbortController().signal,
        }),
      /proton_extraction_unsupported_archive/
    );
  });
});
