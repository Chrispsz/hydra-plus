/**
 * Pure helpers for the portable self-update pipeline (no Electron imports so
 * they stay unit-testable under node --test).
 */

/**
 * Compares dotted numeric versions ("4.4.0", "4.5", "4.5.1-staging").
 * Returns true when `candidate` is strictly newer than `current`.
 */
export const isNewerVersion = (candidate: string, current: string): boolean => {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);

  const candidateParts = parse(candidate);
  const currentParts = parse(current);
  const length = Math.max(candidateParts.length, currentParts.length);

  for (let index = 0; index < length; index++) {
    const candidatePart = candidateParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;

    if (candidatePart > currentPart) return true;
    if (candidatePart < currentPart) return false;
  }

  return false;
};

export interface LatestYmlInfo {
  version?: string;
  path?: string;
  sha512?: string;
}

/**
 * Parses the fields we need from electron-builder's latest.yml (the update
 * metadata published alongside the portable exe). Kept dependency-free on
 * purpose — the file is flat YAML with a handful of top-level keys.
 */
export const parseLatestYml = (yml: string): LatestYmlInfo => {
  const readStringField = (field: string) => {
    const match = yml.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
    if (!match) return undefined;

    const value = match[1].trim().replace(/^['"]|['"]$/g, "");
    return value.length > 0 ? value : undefined;
  };

  return {
    version: readStringField("version"),
    path: readStringField("path"),
    sha512: readStringField("sha512"),
  };
};
