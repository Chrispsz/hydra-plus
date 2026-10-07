import assert from "node:assert/strict";
import { it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { inferCustomPathKind } from "./custom-path-kind.ts";

it("infers a selected save file without treating a shared folder as a file", () => {
  const rawPath = "<custom><mac><home>/RetroArch/Super Mario World.srm";
  const game = { shop: "launchbox" as const, platform: "Super Nintendo" };
  assert.equal(
    inferCustomPathKind(
      rawPath,
      [{ relativePath: "Super Mario World.srm" }],
      game
    ),
    "file"
  );
  assert.equal(
    inferCustomPathKind(
      rawPath,
      [
        { relativePath: "Super Mario World.srm" },
        { relativePath: "Another Game.srm" },
      ],
      game
    ),
    "dir"
  );
  assert.equal(
    inferCustomPathKind(
      "<custom><mac><home>/RetroArch/saves",
      [{ relativePath: "Super Mario World.srm" }],
      game
    ),
    "dir"
  );
});

it("infers kind from the file shape regardless of shop", () => {
  const rawPath = "<custom><mac><home>/SteamGame/save.sav";
  const files = [{ relativePath: "save.sav" }];
  const steam = { shop: "steam" as const };

  // A single known save file is recognised as a file-kind custom path.
  assert.equal(inferCustomPathKind(rawPath, files, steam), "file");
  // An explicit stored kind always wins.
  assert.equal(
    inferCustomPathKind(rawPath, files, {
      ...steam,
      storedKind: "dir",
    }),
    "dir"
  );
  // Several files under the path always infer a directory.
  assert.equal(
    inferCustomPathKind(rawPath, [files[0], { relativePath: "b.sav" }], steam),
    "dir"
  );
});
