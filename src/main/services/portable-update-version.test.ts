import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isNewerVersion, parseLatestYml } from "./portable-update-version.js";

describe("isNewerVersion", () => {
  it("detects strictly newer versions", () => {
    assert.equal(isNewerVersion("4.5.0", "4.4.0"), true);
    assert.equal(isNewerVersion("4.4.1", "4.4.0"), true);
    assert.equal(isNewerVersion("5", "4.9.9"), true);
    assert.equal(isNewerVersion("4.5", "4.4.2"), true);
  });

  it("rejects equal and older versions", () => {
    assert.equal(isNewerVersion("4.4.0", "4.4.0"), false);
    assert.equal(isNewerVersion("4.3.9", "4.4.0"), false);
    assert.equal(isNewerVersion("4", "4.0.1"), false);
  });

  it("tolerates the v prefix and prerelease suffixes", () => {
    assert.equal(isNewerVersion("v4.5.0", "4.4.0"), true);
    assert.equal(isNewerVersion("4.5.0-staging", "4.4.0"), true);
    assert.equal(isNewerVersion("4.4.0", "v4.4.0"), false);
  });

  it("treats malformed input as zero-filled parts", () => {
    assert.equal(isNewerVersion("4.5.0", ""), true);
    assert.equal(isNewerVersion("", "4.5.0"), false);
  });
});

describe("parseLatestYml", () => {
  it("reads version, path and sha512 from electron-builder output", () => {
    const yml = [
      "version: 4.5.0",
      "path: hydra-plus-4.5.0-portable.exe",
      "sha512: 3q2+7wAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      "releaseDate: '2025-01-01T00:00:00.000Z'",
    ].join("\n");

    assert.deepEqual(parseLatestYml(yml), {
      version: "4.5.0",
      path: "hydra-plus-4.5.0-portable.exe",
      sha512:
        "3q2+7wAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    });
  });

  it("returns undefined fields when the yml is missing entries", () => {
    assert.deepEqual(parseLatestYml("version: 4.5.0"), {
      version: "4.5.0",
      path: undefined,
      sha512: undefined,
    });
    assert.deepEqual(parseLatestYml(""), {
      version: undefined,
      path: undefined,
      sha512: undefined,
    });
  });

  it("unquotes single and double quoted values", () => {
    assert.equal(
      parseLatestYml("path: 'hydra-plus-portable.exe'").path,
      "hydra-plus-portable.exe"
    );
    assert.equal(
      parseLatestYml('path: "hydra-plus-portable.exe"').path,
      "hydra-plus-portable.exe"
    );
  });
});
