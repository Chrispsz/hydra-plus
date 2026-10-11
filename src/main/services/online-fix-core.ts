/**
 * Pure core of the Online-Fix launch preparation (no Electron, no fs) so
 * it stays unit-testable under node --test.
 */

export const MAX_SCANNED_DLL_OVERRIDES = 40;

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
 * Classic proxy DLLs used by Online-Fix/FreeTP patches. Forced as
 * "native,builtin": when the patch ships one, the native copy wins;
 * when it does not, Wine falls back to the built-in harmlessly.
 */
export const ONLINE_FIX_PROXY_DLLS = [
  "winmm",
  "version",
  "dinput8",
  "winhttp",
  "dsound",
  "xinput1_3",
  "xinput1_4",
  "xinput9_1_0",
] as const;

const D3D_OVERRIDE_NAMES = new Set(
  ONLINE_FIX_D3D_OVERRIDES.map((override) => override.split("=")[0])
);

/** API-set / driver shims must never be forced native. */
export const isSkippableDllName = (name: string) =>
  name.startsWith("api-ms-win-") || name.startsWith("ext-ms-");

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

    const name = rawName
      .toLowerCase()
      .trim()
      .replace(/\.dll$/, "");
    if (!name || D3D_OVERRIDE_NAMES.has(name) || isSkippableDllName(name)) {
      continue;
    }

    if (addOverride(name)) scanned += 1;
  }

  return Array.from(overrides).join(";");
};
