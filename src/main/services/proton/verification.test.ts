import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import type { ProtonRelease } from "@types";

import {
  decideVerification,
  parseDigest,
  verifyProtonArchive,
} from "./verification.ts";

const roots: string[] = [];

const createRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-proton-verify-")
  );
  roots.push(root);
  return root;
};

after(async () => {
  await Promise.all(
    roots.map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

const makeRelease = (
  overrides: Partial<ProtonRelease> = {}
): ProtonRelease => ({
  tag: "GE-Proton9-20",
  name: "GE-Proton 9-20",
  publishedAt: "2024-10-01T00:00:00Z",
  sizeBytes: 0,
  downloadUrl: "https://example.com/GE-Proton9-20.tar.gz",
  ...overrides,
});

describe("parseDigest", () => {
  it("accepts sha256 digests case-insensitively", () => {
    const hex = "A".repeat(64);
    assert.deepEqual(parseDigest(`sha256:${hex}`), {
      algorithm: "sha256",
      hex: hex.toLowerCase(),
    });
  });

  it("rejects empty, missing and unsupported digests", () => {
    assert.equal(parseDigest(undefined), null);
    assert.equal(parseDigest(""), null);
    assert.equal(parseDigest("md5:" + "a".repeat(32)), null);
    assert.equal(parseDigest("sha256:tooshort"), null);
    assert.equal(parseDigest("sha256:" + "g".repeat(64)), null);
  });
});

describe("decideVerification", () => {
  it("verifies size only when the asset reports one", () => {
    assert.deepEqual(decideVerification(makeRelease()), {
      verifySize: false,
      verifyDigest: false,
    });
    assert.deepEqual(decideVerification(makeRelease({ sizeBytes: 10 })), {
      verifySize: true,
      verifyDigest: false,
    });
  });

  it("verifies the digest only for a usable sha256 value", () => {
    assert.deepEqual(
      decideVerification(makeRelease({ digest: `sha256:${"a".repeat(64)}` })),
      { verifySize: false, verifyDigest: true }
    );
    assert.deepEqual(
      decideVerification(makeRelease({ digest: "sha512:" + "a".repeat(128) })),
      { verifySize: false, verifyDigest: false }
    );
  });
});

describe("verifyProtonArchive", () => {
  it("passes when size and sha256 digest match", async () => {
    const root = await createRoot();
    const archivePath = path.join(root, "archive.tar.gz");
    const content = Buffer.from("proton archive bytes");
    await fs.promises.writeFile(archivePath, content);
    const hex = crypto.createHash("sha256").update(content).digest("hex");

    const result = await verifyProtonArchive(
      archivePath,
      makeRelease({ sizeBytes: content.length, digest: `sha256:${hex}` })
    );

    assert.deepEqual(result, { ok: true });
  });

  it("fails on a size mismatch", async () => {
    const root = await createRoot();
    const archivePath = path.join(root, "archive.tar.gz");
    await fs.promises.writeFile(archivePath, Buffer.from("1234"));

    const result = await verifyProtonArchive(
      archivePath,
      makeRelease({ sizeBytes: 999 })
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /^proton_verification_size_mismatch/);
  });

  it("fails on a digest mismatch", async () => {
    const root = await createRoot();
    const archivePath = path.join(root, "archive.tar.gz");
    await fs.promises.writeFile(archivePath, Buffer.from("1234"));

    const result = await verifyProtonArchive(
      archivePath,
      makeRelease({ digest: `sha256:${"b".repeat(64)}` })
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, "proton_verification_digest_mismatch");
  });

  it("fails clearly when the archive is missing", async () => {
    const root = await createRoot();

    const result = await verifyProtonArchive(
      path.join(root, "missing.tar.gz"),
      makeRelease({ sizeBytes: 10 })
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /^proton_verification_failed/);
  });

  it("skips checks the release cannot support", async () => {
    const root = await createRoot();
    const archivePath = path.join(root, "archive.tar.gz");
    await fs.promises.writeFile(archivePath, Buffer.from("no checks"));

    const result = await verifyProtonArchive(archivePath, makeRelease());

    assert.deepEqual(result, { ok: true });
  });
});
