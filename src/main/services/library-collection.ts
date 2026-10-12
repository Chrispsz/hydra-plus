import type { Game } from "@types";

export const belongsToLibraryCollection = (
  game: Pick<Game, "isDeleted" | "isConcealed">,
  collection: "visible" | "hidden" | "all"
) =>
  !game.isDeleted &&
  (collection === "all" ||
    Boolean(game.isConcealed) === (collection === "hidden"));
