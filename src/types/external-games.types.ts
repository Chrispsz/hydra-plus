export type ExternalGameSource =
  | "hytale"
  | "linux_desktop_entry"
  | "windows_registry";

/**
 * A game installed outside Hydra that the scan surfaced as a suggestion.
 * The user confirms candidates in the import modal before they join the
 * library, so every field here is best-effort and never authoritative.
 */
export interface ExternalGameCandidate {
  /** Stable slug (source + hash of exe/title). */
  id: string;
  title: string;
  executablePath: string | null;
  iconPath: string | null;
  platform: "windows" | "linux";
  source: ExternalGameSource;
  /** True when the scan can tell this is a game (e.g. Game desktop category). */
  isGameHint: boolean;
  /** Absolute, existing paths to register as cloud-save custom paths. */
  savePaths: string[];
}
