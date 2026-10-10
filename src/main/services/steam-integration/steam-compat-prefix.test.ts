import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findSteamCompatibilityPrefixInLibraries } from "./steam-compat-prefix-core.ts";

const createValidPrefix = async (library: string, appId: string) => {
  const prefixPath = path.join(
    library,
    "steamapps",
    "compatdata",
    appId,
    "pfx"
  );
  await fs.promises.mkdir(path.join(prefixPath, "dosdevices"), {
    recursive: true,
  });
  await fs.promises.mkdir(path.join(prefixPath, "drive_c"), {
    recursive: true,
  });
  for (const registryFile of ["system.reg", "user.reg", "userdef.reg"]) {
    await fs.promises.writeFile(path.join(prefixPath, registryFile), "");
  }
  return prefixPath;
};

test("finds a valid Proton prefix across multiple Steam libraries", async () => {
  const firstLibrary = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-steam-lib-a-")
  );
  const secondLibrary = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-steam-lib-b-")
  );

  assert.equal(
    findSteamCompatibilityPrefixInLibraries([firstLibrary], "2379780"),
    null
  );

  const prefixPath = await createValidPrefix(secondLibrary, "2379780");

  assert.equal(
    findSteamCompatibilityPrefixInLibraries(
      [firstLibrary, secondLibrary],
      "2379780"
    ),
    prefixPath
  );
});

test("ignores incomplete compatdata prefixes", async () => {
  const library = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-steam-lib-c-")
  );

  const incompletePrefix = path.join(
    library,
    "steamapps",
    "compatdata",
    "620",
    "pfx"
  );
  await fs.promises.mkdir(incompletePrefix, { recursive: true });

  assert.equal(findSteamCompatibilityPrefixInLibraries([library], "620"), null);
});

test("skips prefixes of other apps", async () => {
  const library = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-steam-lib-d-")
  );

  await createValidPrefix(library, "620");

  assert.equal(
    findSteamCompatibilityPrefixInLibraries([library], "1245620"),
    null
  );
});
