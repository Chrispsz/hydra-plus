import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Installation transaction: staging validation, provenance metadata
 * and the same-filesystem atomic promote with backup/rollback.
 *
 * The staged release directory is renamed into the target
 * compatibilitytools.d directory. Renames are atomic within one
 * filesystem, so the staging directory is always created inside the
 * target's parent directory.
 */

export const STAGING_DIR_PREFIX = ".hydra-proton-stage-";
export const PREVIOUS_DIR_PREFIX = ".hydra-proton-previous-";
export const PROTON_METADATA_FILENAME = ".hydra-proton.json";

export interface ProtonInstallMetadata {
  provider: string;
  tag: string;
  assetName: string;
  installedAt: string;
}

/**
 * A directory is a Proton build when it contains the `proton` launcher
 * and the `toolmanifest.vdf` manifest (the same rule umu.ts applies
 * when listing installed Protons). Duplicated here for module
 * isolation; consolidating is a follow-up.
 */
export const isValidProtonDirectory = (directoryPath: string): boolean => {
  const protonFilePath = path.join(directoryPath, "proton");
  const toolManifestPath = path.join(directoryPath, "toolmanifest.vdf");

  return fs.existsSync(protonFilePath) && fs.existsSync(toolManifestPath);
};

/**
 * The staging directory must hold exactly one root directory and it
 * must be a valid Proton build; anything else is a broken archive.
 */
export const inspectStagedProton = (
  stagingDir: string
): { releaseDirName: string } => {
  const entries = fs.readdirSync(stagingDir, { withFileTypes: true });

  if (entries.length !== 1) {
    throw new Error(
      `proton_invalid_archive_layout:expected 1 root entry, found ${entries.length}`
    );
  }

  const [entry] = entries;
  if (!entry.isDirectory()) {
    throw new Error(
      "proton_invalid_archive_layout:root entry is not a directory"
    );
  }

  const releaseDirPath = path.join(stagingDir, entry.name);
  if (!isValidProtonDirectory(releaseDirPath)) {
    throw new Error(
      "proton_invalid_archive_layout:missing proton or toolmanifest.vdf"
    );
  }

  return { releaseDirName: entry.name };
};

export const writeProtonMetadata = async (
  installedDir: string,
  metadata: ProtonInstallMetadata
): Promise<void> => {
  await fs.promises.writeFile(
    path.join(installedDir, PROTON_METADATA_FILENAME),
    JSON.stringify(metadata, null, 2),
    "utf8"
  );
};

export const createStagingDir = async (targetDir: string): Promise<string> => {
  const targetParent = path.dirname(targetDir);
  await fs.promises.mkdir(targetParent, { recursive: true });
  return fs.promises.mkdtemp(path.join(targetParent, STAGING_DIR_PREFIX));
};

export const createPreviousSuffix = (): string =>
  crypto.randomBytes(3).toString("hex");

export interface PromoteStagedProtonOptions {
  stagingDir: string;
  releaseDirName: string;
  targetDir: string;
  metadata: ProtonInstallMetadata;
  /** Injectable for the rollback tests. */
  rename?: typeof fs.promises.rename;
  createSuffix?: () => string;
}

/**
 * Atomically moves the staged release into the target directory:
 *
 * 1. an existing destination is renamed aside to a backup sibling;
 * 2. the staged directory is renamed into place;
 * 3. if step 2 fails, the backup is restored (rollback);
 * 4. on success the backup is deleted and provenance metadata is
 *    written inside the installed directory.
 */
export const promoteStagedProton = async (
  options: PromoteStagedProtonOptions
): Promise<void> => {
  const rename = options.rename ?? fs.promises.rename;
  const createSuffix = options.createSuffix ?? createPreviousSuffix;

  const stagedPath = path.join(options.stagingDir, options.releaseDirName);
  const destinationPath = path.join(options.targetDir, options.releaseDirName);
  const targetParent = path.dirname(options.targetDir);

  await fs.promises.mkdir(options.targetDir, { recursive: true });

  let previousPath: string | null = null;

  if (fs.existsSync(destinationPath)) {
    previousPath = path.join(
      targetParent,
      `${PREVIOUS_DIR_PREFIX}${createSuffix()}`
    );
    await rename(destinationPath, previousPath);
  }

  try {
    await rename(stagedPath, destinationPath);
  } catch (error) {
    if (previousPath !== null) {
      try {
        await rename(previousPath, destinationPath);
      } catch (rollbackError) {
        throw new Error("proton_promote_rollback_failed", {
          cause: rollbackError,
        });
      }
    }
    throw error;
  }

  try {
    await writeProtonMetadata(destinationPath, options.metadata);
  } catch {
    // Provenance metadata is best-effort: the build is installed and
    // usable without it, so a failure must not fail the transaction.
  }

  if (previousPath !== null) {
    await fs.promises.rm(previousPath, { recursive: true, force: true });
  }
};
