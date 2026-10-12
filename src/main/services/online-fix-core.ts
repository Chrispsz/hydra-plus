/**
 * Pure core of the Online-Fix launch preparation (no Electron, no fs) so
 * it stays unit-testable under node --test.
 */

export const MAX_SCANNED_DLL_OVERRIDES = 64;

/**
 * The fix's OWN payload modules (patch loader, overlay, networking, the
 * patched steam_api and known fix loaders shipped by online-fix.me
 * packages) plus the classic loader proxies. Every entry is loaded as
 * "native,builtin" (`=n,b`): when the package ships the file it shadows
 * Wine's built-in exactly as on Windows; when it does not (or an
 * antivirus quarantined it) Wine falls back to its built-in instead of
 * dying with ERROR_MOD_NOT_FOUND — the "error 126".
 *
 * Wine loader proof (dlls/ntdll/unix/loader.c, map_pe_file): under a
 * STRICT `=n` override the loader REJECTS any file that maps as a Wine
 * built-in/fake dll with STATUS_DLL_NOT_FOUND — it never keeps looking
 * for a native copy. Forcing `=n` on system DLL names (d3d11, dxgi,
 * d3d9, …) therefore breaks the load of every game that does not ship
 * them — the recurring "error 126" on Linux that even SOFL/OFLL carry
 * in their recipes. `=n,b` is strictly dominant: native first, built-in
 * only when the native file genuinely does not exist.
 */
export const ONLINE_FIX_PAYLOAD_DLLS = [
  "onlinefix64",
  "onlinefix",
  "steamoverlay64",
  "steamoverlay",
  "steam_api64",
  "steam_api",
  "dnet",
  "dnet64",
  "steamclient64",
  "emp",
  "custom",
  "epicfix",
] as const;

/**
 * Classic loader proxy DLLs. Forced as "native,builtin" (`=n,b`): when
 * the patch ships one, the native copy wins; when it does not, Wine
 * falls back to the built-in harmlessly.
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

/**
 * Files an Online-Fix package drops (usually at the game root) that the
 * patch loader MUST find next to the game executable. Unreal-style
 * layouts (Binaries/Win64/*-Shipping.exe) leave them out of the loader's
 * DLL search path — the #1 cause of "error 126" on both platforms.
 */
export const ONLINE_FIX_PAYLOAD_FILES = [
  "onlinefix64.dll",
  "onlinefix.dll",
  "steamoverlay64.dll",
  "steamoverlay.dll",
  "steam_api64.dll",
  "steam_api.dll",
  "dnet.dll",
  "dnet64.dll",
  "onlinefix.ini",
  "dlllist.txt",
  "winmm.txt",
  "steam_appid.txt",
  "onlinefix.json",
  "launch_data.of",
  "newtonsoft.json.dll",
] as const;

/**
 * Payload directories mirrored alongside the files (fix-side Steam
 * settings replacing steam_api's default ones).
 */
export const ONLINE_FIX_PAYLOAD_DIRECTORIES = ["steam_settings"] as const;

/** Files bigger than this are never mirrored (only small patch payload). */
export const ONLINE_FIX_MIRROR_MAX_FILE_BYTES = 15 * 1024 * 1024;

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

/** API-set / driver shims must never be overridden. */
export const isSkippableDllName = (name: string) =>
  name.startsWith("api-ms-win-") || name.startsWith("ext-ms-");

/**
 * The Steam appid the fix relays through. Online-Fix drives multiplayer
 * with Valve's Spacewar demo (480): the running client shows it while the
 * game's patched steam_api drives the lobbies. The Steam context env must
 * pin this id so the client and the fix agree on the session.
 */
export const ONLINE_FIX_STEAM_APP_ID = "480";

export const normalizeDllOverrideName = (rawName: string): string | null => {
  const name = rawName
    .toLowerCase()
    .trim()
    .replace(/\.dll$/, "");
  if (!name || isSkippableDllName(name)) return null;
  return name;
};

/**
 * Builds the WINEDLLOVERRIDES value for an online session from the DLL
 * file names found next to the game's executable: the fix payload family
 * + loader proxies + every other shipped DLL, all as "native,builtin"
 * (`=n,b`) — see the payload family rationale above for why strict
 * `=n` is never used.
 */
export const buildOnlineFixDllOverrides = (dllNames: string[]): string => {
  const overrides = new Set<string>();
  let scanned = 0;

  const addOverride = (name: string) => {
    if (!name || isSkippableDllName(name)) return false;
    if (overrides.has(`${name}=n,b`)) return false;
    overrides.add(`${name}=n,b`);
    return true;
  };

  ONLINE_FIX_PAYLOAD_DLLS.forEach(addOverride);
  ONLINE_FIX_PROXY_DLLS.forEach(addOverride);

  for (const rawName of dllNames) {
    if (scanned >= MAX_SCANNED_DLL_OVERRIDES) break;

    const name = normalizeDllOverrideName(rawName);
    if (!name) continue;

    if (addOverride(name)) scanned += 1;
  }

  return Array.from(overrides).join(";");
};

export interface OnlineFixIniSanitizeResult {
  content: string;
  changed: boolean;
  /** RealAppId/FakeAppId read from the ini (overlay session id). */
  fakeAppId: string | null;
}

/**
 * Patches an onlinefix.ini in memory, mirroring OFLL's recipe:
 * `[Misc] ExtraProtection` is an anti-tamper that reliably kills Wine
 * sessions (OFLL #53), so it is forced to false; FakeAppId is captured
 * so the Steam overlay joins the session the fix actually uses.
 */
export const sanitizeOnlineFixIni = (
  content: string
): OnlineFixIniSanitizeResult => {
  const fakeAppIdMatch = content.match(/FakeAppId\s*=\s*(\d+)/i);
  const fakeAppId = fakeAppIdMatch?.[1] ?? null;

  const patched = content.replace(
    /(ExtraProtection\s*=\s*)true(\s*)$/im,
    "$1false$2"
  );

  return { content: patched, changed: patched !== content, fakeAppId };
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

// ---------------------------------------------------------------------------
// Steam install kind (pure decision part)
// ---------------------------------------------------------------------------

export type SteamInstallKind = "native" | "flatpak" | "snap" | "unknown";

export interface SteamInstallKindSignals {
  /** A native `steam` launcher binary exists (e.g. /usr/bin/steam). */
  nativeBinaryAvailable: boolean;
  /** The native Steam root exists (~/.steam/steam symlink). */
  nativeSteamRootPresent: boolean;
  /** `flatpak info com.valvesoftware.Steam` succeeded. */
  flatpakRegistered: boolean;
  /** The Flatpak app data directory exists (may be a leftover). */
  flatpakDirPresent: boolean;
  /** `snap list steam` succeeded. */
  snapRegistered: boolean;
  /** The Snap data directory exists (may be a leftover). */
  snapDirPresent: boolean;
}

/**
 * Decides how the Steam client is installed from raw signals. Order is
 * load-bearing: package-manager signals beat data directories because
 * LEFTOVER directories are common — a machine that once tried the Flatpak
 * Steam keeps ~/.var/app/com.valvesoftware.Steam forever, even after the
 * user switched to the distribution's native package. Native wins first:
 * a native `steam` binary is what actually launches when the client is
 * started, so it is the truth that matters for the online session.
 */
export const resolveSteamInstallKind = (
  signals: SteamInstallKindSignals
): SteamInstallKind => {
  if (signals.nativeBinaryAvailable || signals.nativeSteamRootPresent) {
    return "native";
  }
  if (signals.flatpakRegistered || signals.flatpakDirPresent) {
    return "flatpak";
  }
  if (signals.snapRegistered || signals.snapDirPresent) {
    return "snap";
  }
  return "unknown";
};

// ---------------------------------------------------------------------------
// Steam session context env (pure)
// ---------------------------------------------------------------------------

export interface OnlineFixSteamContextEnv {
  SteamAppId: string;
  SteamGameId: string;
  SteamOverlayGameId: string;
  ENABLE_VK_LAYER_VALVE_steam_overlay_1: string;
}

/**
 * Steam context for an Online-Fix session (Windows + Linux). The fix
 * relays multiplayer through Spacewar (480) on the user's real client:
 * pinning SteamAppId/SteamGameId to 480 aligns the Wine side with the
 * client, and SteamOverlayGameId joins the overlay to the fix's own
 * session (the onlinefix.ini FakeAppId when present). The Vulkan layer
 * flag is the OFLL recipe that lets the preloaded native overlay renderer
 * attach under Proton.
 */
export const buildOnlineFixSteamContextEnv = (
  fakeAppId?: string | null
): OnlineFixSteamContextEnv => ({
  SteamAppId: ONLINE_FIX_STEAM_APP_ID,
  SteamGameId: ONLINE_FIX_STEAM_APP_ID,
  SteamOverlayGameId: fakeAppId || ONLINE_FIX_STEAM_APP_ID,
  ENABLE_VK_LAYER_VALVE_steam_overlay_1: "1",
});

// ---------------------------------------------------------------------------
// Steam Linux Runtime candidates (pure)
// ---------------------------------------------------------------------------

/**
 * Steam Linux Runtime entry points to try, in order, for each Steam
 * library root. Modern Proton builds are compiled against the sniper
 * runtime; wrapping the launch with its _v2-entry-point reproduces the
 * container Steam itself uses, so host library mismatches stop mattering.
 */
export const buildSteamRuntimeCandidatePaths = (
  libraryRoots: string[]
): string[] => {
  const runtimes = ["SteamLinuxRuntime_sniper", "SteamLinuxRuntime_soldier"];
  const candidates: string[] = [];

  for (const libraryRoot of libraryRoots) {
    for (const runtime of runtimes) {
      candidates.push(
        [libraryRoot, "steamapps", "common", runtime, "_v2-entry-point"].join(
          "/"
        )
      );
    }
  }

  return candidates;
};
