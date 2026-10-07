import type { GameShop, RestoreManifestFile } from "@types";

const KNOWN_SAVE_FILE =
  /\.(?:srm|rtc|sav|SAVESTAT(?:\.zst|\.gz)?|state(?:\d+|\.auto)?(?:\.png)?)$/i;

/** Old snapshots have no custom path kind. Infer only exact, known save files. */
export const inferCustomPathKind = (
  rawPath: string,
  files: Pick<RestoreManifestFile, "relativePath">[],
  {
    storedKind,
  }: {
    shop: GameShop;
    platform?: string | null;
    storedKind?: "file" | "dir";
  }
): "file" | "dir" => {
  if (storedKind) return storedKind;
  if (files.length !== 1) return "dir";
  const leaf = rawPath.split("/").at(-1);
  return leaf && KNOWN_SAVE_FILE.test(leaf) && files[0].relativePath === leaf
    ? "file"
    : "dir";
};
