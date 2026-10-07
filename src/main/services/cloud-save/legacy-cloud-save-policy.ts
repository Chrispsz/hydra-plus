import type { Game } from "@types";

/**
 * Legacy (v1) Cloud Save writes used to be blocked for emulator-managed
 * games, whose saves were owned by the v2 engine. Retro emulation was
 * removed from the fork, so every remaining legacy game may write freely.
 * Kept as a no-op so legacy flow call sites stay untouched.
 */
export const assertLegacyCloudSaveWriteAllowed = (
  _game: Pick<Game, "shop" | "platform"> | null | undefined
) => {};
