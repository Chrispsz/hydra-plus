/**
 * Pure core of the Online-Fix launch preparation (no Electron, no fs) so
 * it stays unit-testable under node --test.
 */

export const MAX_SCANNED_DLL_OVERRIDES = 64;

/**
 * Community recipe (SOFL/OFLL): force the native Direct3D path so the
 * Steam networking hooks and overlay load as on Windows instead of the
 * wined3d translations.
 */
export const ONLINE_FIX_D3D_OVERRIDES = [
  "d3d11=n",
  "d3d10=n",
  "d3d10core=n",
  "dxgi=n",
  "openvr_api_dxvk=n",
  "d3d12=n",
  "d3d12core=n",
  "d3d9=n",
  "d3d8=n",
] as const;

/**
 * DLLs shipped by Online-Fix patches and classic proxy loaders. Forced as
 * "native,builtin": when the patch ships one, the native copy wins;
 * when it does not, Wine falls back to the built-in harmlessly.
 *
 * `onlinefix64`/`steamoverlay64`/`dnet` are the fix's own payload and
 * overlay modules (mirroring SOFL's default override list) — they MUST
 * win over any built-in or they fail to hook the game.
 */
export const ONLINE_FIX_PROXY_DLLS = [
  "onlinefix64",
  "steamoverlay64",
  "dnet",
  "winmm",
  "version",
  "dinput8",
  "winhttp",
  "dsound",
  "xinput1_3",
  "xinput1_4",
  "xinput9_1_0",
] as const;

/**
 * The files an Online-Fix patch drops next to the game executable.
 * Used by the diagnostics IPC to detect an antivirus quarantine (the
 * patch DLLs disappearing is the classic cause of the "error 126"
 * overlay failure).
 */
export const ONLINE_FIX_MARKER_DLLS = [
  "onlinefix64.dll",
  "onlinefix.dll",
  "steamoverlay64.dll",
] as const;

const D3D_OVERRIDE_NAMES = new Set(
  ONLINE_FIX_D3D_OVERRIDES.map((override) => override.split("=")[0])
);

/** API-set / driver shims must never be forced native. */
export const isSkippableDllName = (name: string) =>
  name.startsWith("api-ms-win-") || name.startsWith("ext-ms-");

export const normalizeDllOverrideName = (rawName: string): string | null => {
  const name = rawName
    .toLowerCase()
    .trim()
    .replace(/\.dll$/, "");
  if (!name || D3D_OVERRIDE_NAMES.has(name) || isSkippableDllName(name)) {
    return null;
  }
  return name;
};

/**
 * Builds the WINEDLLOVERRIDES value for an online session from the DLL
 * file names found next to the game's executable: the community D3D
 * recipe + every shipped DLL as "native,builtin" (fix proxy DLLs win
 * over Wine's built-ins) + the well-known proxy DLLs defensively.
 */
export const buildOnlineFixDllOverrides = (dllNames: string[]): string => {
  const overrides = new Set<string>(ONLINE_FIX_D3D_OVERRIDES);
  let scanned = 0;

  const addOverride = (name: string) => {
    if (!name || isSkippableDllName(name)) return false;
    if (overrides.has(`${name}=n`) || overrides.has(`${name}=n,b`)) {
      return false;
    }
    overrides.add(`${name}=n,b`);
    return true;
  };

  ONLINE_FIX_PROXY_DLLS.forEach((name) => addOverride(name));

  for (const rawName of dllNames) {
    if (scanned >= MAX_SCANNED_DLL_OVERRIDES) break;

    const name = normalizeDllOverrideName(rawName);
    if (!name) continue;

    if (addOverride(name)) scanned += 1;
  }

  return Array.from(overrides).join(";");
};

/**
 * Detects the presence of Online-Fix marker DLLs among a scanned file
 * listing (diagnostics for the "antivirus ate the patch" failure mode).
 */
export const findOnlineFixMarkerDlls = (fileNames: string[]): string[] => {
  const seen = new Set(
    fileNames.map((name) => name.toLowerCase().trim()).filter(Boolean)
  );
  return ONLINE_FIX_MARKER_DLLS.filter((marker) => seen.has(marker));
};

/**
 * Prepends the game directory to a Windows PATH so the patch loader and
 * its payload DLLs resolve their dependencies by name no matter which
 * working directory the game ends up with.
 */
export const buildWindowsOnlineFixPath = (
  gameDirectory: string,
  currentPath: string
): string => {
  const separator = ";";
  const existingEntries = currentPath
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry.toLowerCase() !== gameDirectory.toLowerCase());

  return [gameDirectory, ...existingEntries].join(separator);
};
