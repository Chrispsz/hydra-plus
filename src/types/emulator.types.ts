/*
 * LaunchBox "classics" discs. `Game.discs` / `Game.selectedDiscPath` are still
 * live: game shortcuts (Steam + desktop), delete-game-folder and the library UI
 * pick which disc launches.
 */
export interface ClassicsDisc {
  path: string;
  label: string;
  fileName: string;
  sku?: string | null;
}

/** A game save detected inside a PS2 memory card (`.ps2`) image. */
export interface Ps2MemoryCardSaveRecord {
  cardFilePath: string; // absolute path to the .ps2 file
  cardLabel: string; // basename, e.g. "Mcd001.ps2"
  hostname?: string; // current device, populated when records are listed
  folderName: string; // on-card save folder, e.g. "BESLES-50009"
  sku: string | null; // normalized "SLES-50009", or null if unrecognized
  objectId: string | null; // resolved LaunchBox objectId, or null if unmatched
  shop: "launchbox" | null;
  title: string | null; // resolved title (UI falls back to folderName)
  iconUrl: string | null;
  libraryImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  fileCount: number;
  sizeBytes: number;
  createdAt: number; // save's created time (epoch ms)
  modifiedAt: number; // save's modified time (epoch ms)
  detectedAt: number; // when this scan recorded it (epoch ms)
}

/*
 * PS1 (DuckStation) memory card saves reuse the exact same record shape as
 * PS2 — only the on-card format and export container differ. This neutral
 * alias lets the shared sublevel read system-agnostic. For PS1, `folderName`
 * holds the on-card save identifier and `fileCount` holds the block count.
 */
export type MemoryCardSaveRecord = Ps2MemoryCardSaveRecord;
