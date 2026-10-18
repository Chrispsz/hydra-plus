import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  getCompatToolRoots,
  getProtonInstallTargetList,
  resolveInstallTarget,
  validateProtonRemoval,
} from "./install-targets.ts";
import { isValidProtonDirectory } from "./install-transaction.ts";

const roots: string[] = [];

const createRoot = async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-proton-targets-")
  );
  roots.push(root);
  return root;
};

const createProtonBuild = async (directoryPath: string) => {
  await fs.promises.mkdir(directoryPath, { recursive: true });
  await fs.promises.writeFile(
    path.join(directoryPath, "proton"),
    "#!/bin/sh\n"
  );
  await fs.promises.writeFile(
    path.join(directoryPath, "toolmanifest.vdf"),
    '"manifest"\n'
  );
};

after(async () => {
  await Promise.all(
    roots.map((root) => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

const makeInput = (homePath: string, libraryFolders: string[] = []) => ({
  homePath,
  libraryFolders,
  extraCompatToolPaths: [],
});

describe("resolveInstallTarget", () => {
  it("prefers the first existing Steam root compatibilitytools.d", async () => {
    const home = await createRoot();
    const steamRoot = path.join(
      home,
      ".steam",
      "steam",
      "compatibilitytools.d"
    );
    await fs.promises.mkdir(steamRoot, { recursive: true });

    const resolved = resolveInstallTarget(makeInput(home));

    assert.equal(resolved.targetDir, steamRoot);
    assert.equal(resolved.isDefaultRoot, false);
  });

  it("falls back to the standard per-user Steam root when none exists", async () => {
    const home = await createRoot();

    const resolved = resolveInstallTarget(makeInput(home));

    assert.equal(
      resolved.targetDir,
      path.join(home, ".local", "share", "Steam", "compatibilitytools.d")
    );
    assert.equal(resolved.isDefaultRoot, true);
  });

  it("uses an existing Steam library compatibilitytools.d after Steam roots", async () => {
    const home = await createRoot();
    const library = path.join(home, "games-library");
    const libraryCompat = path.join(library, "compatibilitytools.d");
    await fs.promises.mkdir(libraryCompat, { recursive: true });

    const resolved = resolveInstallTarget(makeInput(home, [library]));

    assert.equal(resolved.targetDir, libraryCompat);
  });

  it("ignores files that share the compatibilitytools.d name", async () => {
    const home = await createRoot();
    const fakeRoot = path.join(home, ".steam", "steam", "compatibilitytools.d");
    await fs.promises.mkdir(path.dirname(fakeRoot), { recursive: true });
    await fs.promises.writeFile(fakeRoot, "not a directory");

    const resolved = resolveInstallTarget(makeInput(home));

    assert.equal(
      resolved.targetDir,
      path.join(home, ".local", "share", "Steam", "compatibilitytools.d")
    );
  });
});

describe("getProtonInstallTargetList", () => {
  it("marks exactly the resolved target as default and dedupes roots", () => {
    const home = "/home/tester";
    const library = "/mnt/games";

    const targets = getProtonInstallTargetList(
      makeInput(home, [library, library])
    );

    const defaults = targets.filter((target) => target.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(
      defaults[0]?.path,
      path.join(home, ".local", "share", "Steam", "compatibilitytools.d")
    );

    const paths = targets.map((target) => target.path);
    assert.equal(new Set(paths).size, paths.length);

    assert.ok(
      paths.includes(path.join("/usr", "lib", "steam", "compatibilitytools.d"))
    );
    assert.ok(
      paths.includes(path.join(home, ".config", "heroic", "tools", "proton"))
    );
    assert.ok(paths.includes(path.join(library, "compatibilitytools.d")));
  });
});

describe("getCompatToolRoots", () => {
  it("includes extra compatibility tool paths from the input", () => {
    const rootsFound = getCompatToolRoots({
      homePath: "/home/tester",
      libraryFolders: [],
      extraCompatToolPaths: ["/opt/tools"],
    });

    assert.ok(rootsFound.some((root) => root.path === "/opt/tools"));
  });
});

describe("validateProtonRemoval", () => {
  it("allows removing a valid Proton build inside a known root", async () => {
    const root = await createRoot();
    const buildPath = path.join(root, "GE-Proton9-20");
    await createProtonBuild(buildPath);

    const validation = validateProtonRemoval(
      buildPath,
      [{ path: root, label: "Steam" }],
      isValidProtonDirectory
    );

    assert.deepEqual(validation, { ok: true });
  });

  it("rejects the root directory itself", async () => {
    const root = await createRoot();
    await createProtonBuild(path.join(root, "GE-Proton9-20"));

    const validation = validateProtonRemoval(
      root,
      [{ path: root, label: "Steam" }],
      isValidProtonDirectory
    );

    assert.equal(validation.ok, false);
    assert.equal(validation.error, "proton_path_not_allowed");
  });

  it("rejects paths outside every known root", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const buildPath = path.join(outside, "GE-Proton9-20");
    await createProtonBuild(buildPath);

    const validation = validateProtonRemoval(
      buildPath,
      [{ path: root, label: "Steam" }],
      isValidProtonDirectory
    );

    assert.equal(validation.ok, false);
    assert.equal(validation.error, "proton_path_not_allowed");
  });

  it("rejects directories that are not valid Proton builds", async () => {
    const root = await createRoot();
    const buildPath = path.join(root, "not-a-proton");
    await fs.promises.mkdir(buildPath);

    const validation = validateProtonRemoval(
      buildPath,
      [{ path: root, label: "Steam" }],
      isValidProtonDirectory
    );

    assert.equal(validation.ok, false);
    assert.equal(validation.error, "proton_invalid_directory");
  });

  it("resolves symlinked roots when checking containment", async () => {
    const root = await createRoot();
    const realRoot = path.join(root, "real");
    const aliasRoot = path.join(root, "alias");
    await fs.promises.mkdir(realRoot, { recursive: true });
    await fs.promises.symlink(realRoot, aliasRoot, "dir");

    const buildPath = path.join(realRoot, "GE-Proton9-20");
    await createProtonBuild(buildPath);

    const validation = validateProtonRemoval(
      buildPath,
      [{ path: aliasRoot, label: "Steam" }],
      isValidProtonDirectory
    );

    assert.deepEqual(validation, { ok: true });
  });
});
