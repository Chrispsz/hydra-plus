import type { ProtonInstallProgress, ProtonVersion } from "@types";

/**
 * Pure selection helpers for the fork's default-Proton policy, kept free
 * of Electron/main-process imports so the node test runner can load them
 * (see default-proton-selection.test.ts).
 *
 * Policy: the fork's default runtime is Proton CachyOS — the newest
 * installed build, or an automatic install of the latest release when a
 * launch needs one (see ProtonManager.ensureDefaultProtonForLaunch).
 * umu-run stays as the launch wrapper; its OWN default-Proton download
 * (UMU-Proton) is only the last-resort fallback.
 */

/**
 * CachyOS build directory names: the distro package (`proton-cachyos`),
 * the manager-installed versioned layout (`proton-cachyos-11.0-…-slr`)
 * and the tag-named layout the releases used to extract to
 * (`cachyos-11.0-…-slr`). GE-Proton, Valve and UMU-Proton never match.
 */
const CACHYOS_PROTON_NAME_PATTERN = /^(proton-)?cachyos/i;

export const isCachyOsProtonName = (name: string): boolean =>
  CACHYOS_PROTON_NAME_PATTERN.test(name.trim());

/**
 * Picks the newest CachyOS build from an installed-versions scan. The
 * numeric-aware descending sort keeps date-stamped tags in order
 * (`…-20261015-slr` above `…-20261014-slr`) and puts versioned builds
 * above the unversioned distro package directory.
 */
export const pickNewestCachyOsProton = (
  versions: readonly ProtonVersion[]
): ProtonVersion | null => {
  const cachyOsVersions = versions.filter((version) =>
    isCachyOsProtonName(version.name)
  );

  if (cachyOsVersions.length === 0) return null;

  return (
    cachyOsVersions.sort((a, b) =>
      b.name.localeCompare(a.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    )[0] ?? null
  );
};

export type ProtonPreflightStatus =
  | "downloading"
  | "installing"
  | "complete"
  | "error";

export interface ProtonPreflightProgress {
  status: ProtonPreflightStatus;
  detail: string | null;
}

/**
 * Maps an install-job progress payload to the game launcher window's
 * `preflight-progress` shape (the same channel the common-redist
 * preflight uses), so an automatic default-Proton download shows up as
 * "Baixando o Proton <tag>…" / "Proton <tag>" in the launch splash.
 */
export const toProtonPreflightProgress = (
  progress: ProtonInstallProgress
): ProtonPreflightProgress => {
  switch (progress.phase) {
    case "downloading":
      return { status: "downloading", detail: progress.tag };
    case "verifying":
    case "extracting":
    case "promoting":
      return { status: "installing", detail: `Proton ${progress.tag}` };
    case "done":
      return { status: "complete", detail: null };
    case "error":
      return { status: "error", detail: null };
  }
};
