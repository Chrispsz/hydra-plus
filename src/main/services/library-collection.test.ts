import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { belongsToLibraryCollection } from "./library-collection.js";

describe("library collection filter", () => {
  it("puts hidden games only in the private collection", () => {
    const normal = { isDeleted: false, isConcealed: false };
    const hidden = { isDeleted: false, isConcealed: true };
    const deleted = { isDeleted: true, isConcealed: true };

    assert.equal(belongsToLibraryCollection(normal, "visible"), true);
    assert.equal(belongsToLibraryCollection(normal, "hidden"), false);
    assert.equal(belongsToLibraryCollection(hidden, "visible"), false);
    assert.equal(belongsToLibraryCollection(hidden, "hidden"), true);
    assert.equal(belongsToLibraryCollection(deleted, "hidden"), false);
  });
});
