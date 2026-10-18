import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

import type { ProtonRelease } from "@types";

/**
 * Post-download integrity verification: expected asset size plus the
 * release digest (GitHub provides "sha256:<hex>", possibly empty).
 */

export interface ParsedDigest {
  algorithm: "sha256";
  hex: string;
}

const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/i;

/** Only sha256 digests are verifiable; anything else is skipped. */
export const parseDigest = (digest?: string): ParsedDigest | null => {
  if (!digest) return null;

  const match = digest.trim().match(SHA256_DIGEST_PATTERN);
  if (!match) return null;

  return { algorithm: "sha256", hex: match[1].toLowerCase() };
};

export interface VerificationDecision {
  verifySize: boolean;
  verifyDigest: boolean;
}

/**
 * Pure decision: the size check runs whenever the asset reports a
 * positive size; the digest check runs only for a usable sha256 value.
 */
export const decideVerification = (
  release: ProtonRelease
): VerificationDecision => ({
  verifySize: release.sizeBytes > 0,
  verifyDigest: parseDigest(release.digest) !== null,
});

export interface ArchiveVerificationResult {
  ok: boolean;
  error?: string;
}

const sha256File = async (filePath: string): Promise<string> => {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
};

export const verifyProtonArchive = async (
  archivePath: string,
  release: ProtonRelease
): Promise<ArchiveVerificationResult> => {
  const decision = decideVerification(release);

  try {
    if (decision.verifySize) {
      const { size } = await fs.promises.stat(archivePath);
      if (size !== release.sizeBytes) {
        return {
          ok: false,
          error: `proton_verification_size_mismatch:${size}:${release.sizeBytes}`,
        };
      }
    }

    if (decision.verifyDigest) {
      const digest = parseDigest(release.digest);
      const actualHex = await sha256File(archivePath);
      if (digest && actualHex !== digest.hex) {
        return { ok: false, error: "proton_verification_digest_mismatch" };
      }
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `proton_verification_failed:${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
