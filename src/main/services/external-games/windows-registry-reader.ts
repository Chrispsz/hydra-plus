import WinReg from "winreg";

/**
 * Small winreg-backed registry reader shared by the external-game
 * scanners. Follows the steam.ts winreg pattern; win32-only at call time
 * (callers guard on process.platform) and never throws — failures resolve
 * to null/[] so a missing key just means "not detected".
 */

const WINREG_HIVES = {
  HKCU: WinReg.HKCU,
  HKLM: WinReg.HKLM,
} as const;

const openRegistryKey = (options: {
  hive: "HKCU" | "HKLM";
  key: string;
  arch?: string;
}) =>
  new WinReg({
    hive: WINREG_HIVES[options.hive],
    key: options.key,
    ...(options.arch ? { arch: options.arch } : {}),
  });

export const listRegistryKeys = (options: {
  hive: "HKCU" | "HKLM";
  key: string;
  arch?: string;
}): Promise<string[]> =>
  new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve([]);
      return;
    }
    openRegistryKey(options).keys((error, subKeys) => {
      // subKey.key is the full key path; the trailing segment is the name.
      resolve(
        error || !subKeys
          ? []
          : subKeys
              .map((subKey) => subKey.key.split("\\").pop() ?? "")
              .filter(Boolean)
      );
    });
  });

export const readRegistryValue = (options: {
  hive: "HKCU" | "HKLM";
  key: string;
  value: string;
  arch?: string;
}): Promise<string | null> =>
  new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }
    openRegistryKey(options).get(options.value, (error, result) => {
      resolve(error || !result ? null : result.value);
    });
  });
