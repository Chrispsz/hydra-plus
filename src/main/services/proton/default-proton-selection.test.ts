import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProtonInstallProgress, ProtonVersion } from "@types";

import {
  isCachyOsProtonName,
  pickNewestCachyOsProton,
  toProtonPreflightProgress,
} from "./default-proton-selection.ts";

const toVersion = (name: string, path?: string): ProtonVersion => ({
  name,
  path: path ?? `/compatibilitytools.d/${name}`,
  source: "compatibility_tools",
});

describe("isCachyOsProtonName", () => {
  it("matches the distro package and the versioned manager layouts", () => {
    for (const name of [
      "proton-cachyos",
      "proton-cachyos-11.0-20261015-slr",
      "proton-cachyos-10.0-sunset-slr",
      "cachyos-11.0-20261015-slr",
      "PROTON-CACHYOS-10",
      "  proton-cachyos-11.0-20261015-slr  ",
    ]) {
      assert.equal(isCachyOsProtonName(name), true, name);
    }
  });

  it("never matches GE-Proton, Valve, UMU-Proton or wine builds", () => {
    for (const name of [
      "GE-Proton10-12",
      "Proton - Experimental",
      "UMU-Proton-9-2",
      "proton-ge-custom",
      "wine-ge-8-26",
    ]) {
      assert.equal(isCachyOsProtonName(name), false, name);
    }
  });
});

describe("pickNewestCachyOsProton", () => {
  it("picks the newest build with numeric-aware ordering", () => {
    const newest = pickNewestCachyOsProton([
      toVersion("proton-cachyos-11.0-20261014-slr"),
      toVersion("GE-Proton10-12"),
      toVersion("proton-cachyos-11.0-20261015-slr"),
      toVersion("proton-cachyos-10.0-20260425-slr"),
      toVersion("Proton - Experimental"),
    ]);

    assert.equal(newest?.name, "proton-cachyos-11.0-20261015-slr");
  });

  it("prefers versioned builds over the unversioned distro package", () => {
    const newest = pickNewestCachyOsProton([
      toVersion("proton-cachyos"),
      toVersion("proton-cachyos-10.0-20260425-slr"),
    ]);

    assert.equal(newest?.name, "proton-cachyos-10.0-20260425-slr");
  });

  it("falls back to the distro package when it is the only CachyOS build", () => {
    const newest = pickNewestCachyOsProton([
      toVersion("GE-Proton10-12"),
      toVersion("proton-cachyos"),
    ]);

    assert.equal(newest?.name, "proton-cachyos");
  });

  it("returns null without CachyOS builds or with an empty scan", () => {
    assert.equal(
      pickNewestCachyOsProton([
        toVersion("GE-Proton10-12"),
        toVersion("UMU-Proton-9-2"),
      ]),
      null
    );
    assert.equal(pickNewestCachyOsProton([]), null);
  });
});

describe("toProtonPreflightProgress", () => {
  const progressOf = (
    phase: ProtonInstallProgress["phase"]
  ): ProtonInstallProgress => ({
    providerId: "proton-cachyos",
    tag: "cachyos-11.0-20261015-slr",
    phase,
  });

  it("maps the download phase with the tag as detail", () => {
    assert.deepEqual(toProtonPreflightProgress(progressOf("downloading")), {
      status: "downloading",
      detail: "cachyos-11.0-20261015-slr",
    });
  });

  it("maps the local phases to installing with a self-describing detail", () => {
    for (const phase of ["verifying", "extracting", "promoting"] as const) {
      assert.deepEqual(toProtonPreflightProgress(progressOf(phase)), {
        status: "installing",
        detail: "Proton cachyos-11.0-20261015-slr",
      });
    }
  });

  it("maps terminal phases without detail", () => {
    assert.deepEqual(toProtonPreflightProgress(progressOf("done")), {
      status: "complete",
      detail: null,
    });
    assert.deepEqual(toProtonPreflightProgress(progressOf("error")), {
      status: "error",
      detail: null,
    });
  });
});
