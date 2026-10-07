#!/usr/bin/env node
"use strict";

/**
 * Post-build smoke test for the hydra-plus fork.
 *
 * Run from the repository root (CI does this on the Linux runner right after
 * `yarn build:linux`). Validates that a freshly built fork:
 *   1. has the expected electron-vite output bundles (main, preload, renderer);
 *   2. does NOT carry the upstream auto-update feed — the fork must never
 *      self-update from hydralauncher/hydra releases;
 *   3. produced at least one distributable artifact in dist/;
 *   4. has a package.json that parses and is named "hydra-plus".
 *
 * Exits with code 1 if any check fails. No external dependencies.
 */

const fs = require("node:fs");
const path = require("node:path");

const FORBIDDEN_UPSTREAM_UPDATE_FEED = "hydralauncher/hydra";
/**
 * The fork legitimately keeps downloading common redistributables from the
 * upstream's public CDN repo ("hydralauncher/hydra-common-redist"), whose
 * URL contains the forbidden substring. Whitelist it before the check.
 */
const ALLOWED_UPSTREAM_SUBSTRINGS = ["hydralauncher/hydra-common-redist"];
const EXPECTED_PACKAGE_NAME = "hydra-plus";

const OUT_FILES = [
  path.join("out", "main", "index.js"),
  path.join("out", "renderer", "index.html"),
];
/**
 * electron-vite emits the preload bundle as index.js (CJS projects) or
 * index.mjs (ESM projects — this fork sets "type": "module").
 */
const PRELOAD_BUNDLE_ALTERNATIVES = [
  path.join("out", "preload", "index.mjs"),
  path.join("out", "preload", "index.js"),
];

const ARTIFACT_EXTENSIONS = new Set([
  ".exe",
  ".zip",
  ".deb",
  ".rpm",
  ".tar.gz",
  ".appimage",
]);

const failures = [];

function check(label, ok, detail) {
  if (ok) {
    console.log(`PASS: ${label}`);
    if (detail) console.log(`      ${detail}`);
  } else {
    console.log(`FAIL: ${label}`);
    if (detail) console.log(`      ${detail}`);
    failures.push(label);
  }
}

function isFile(relativePath) {
  try {
    return fs.statSync(path.resolve(relativePath)).isFile();
  } catch {
    return false;
  }
}

function listDistArtifacts(distDir) {
  const artifacts = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      const lowered = entry.name.toLowerCase();
      const ext = lowered.endsWith(".tar.gz")
        ? ".tar.gz"
        : path.extname(lowered);

      if (ARTIFACT_EXTENSIONS.has(ext)) {
        artifacts.push(entryPath);
      }
    }
  };

  walk(distDir);
  return artifacts;
}

function main() {
  console.log(
    `Smoke test for ${EXPECTED_PACKAGE_NAME} (cwd: ${process.cwd()})`
  );

  // (a) electron-vite output bundles must exist
  for (const file of OUT_FILES) {
    check(`bundle exists: ${file}`, isFile(file));
  }

  const preloadBundle = PRELOAD_BUNDLE_ALTERNATIVES.find((file) =>
    isFile(file)
  );
  check(
    `preload bundle exists (${PRELOAD_BUNDLE_ALTERNATIVES.join(" or ")})`,
    Boolean(preloadBundle),
    preloadBundle ? `found: ${preloadBundle}` : undefined
  );

  // (b) main bundle must not self-update from the upstream feed
  let mainBundle = null;
  try {
    mainBundle = fs.readFileSync(path.resolve(OUT_FILES[0]), "utf8");
  } catch (error) {
    // Missing bundle is already reported above; avoid a noisy duplicate failure.
    console.log(`SKIP: updater feed check (${error.message})`);
  }

  if (mainBundle !== null) {
    const scannedBundle = ALLOWED_UPSTREAM_SUBSTRINGS.reduce(
      (content, allowed) => content.split(allowed).join(""),
      mainBundle
    );
    const leaksUpstreamFeed = scannedBundle.includes(
      FORBIDDEN_UPSTREAM_UPDATE_FEED
    );
    check(
      `main bundle does not update from upstream feed "${FORBIDDEN_UPSTREAM_UPDATE_FEED}"`,
      !leaksUpstreamFeed
    );
  }

  // (c) at least one distributable artifact in dist/
  let distIsDir = false;
  try {
    distIsDir = fs.statSync(path.resolve("dist")).isDirectory();
  } catch {
    distIsDir = false;
  }

  if (!distIsDir) {
    check(
      "dist/ contains at least one artifact (.exe/.zip/.deb/.rpm/.tar.gz/.AppImage)",
      false,
      "dist/ directory does not exist"
    );
  } else {
    const artifacts = listDistArtifacts(path.resolve("dist"));
    check(
      "dist/ contains at least one artifact (.exe/.zip/.deb/.rpm/.tar.gz/.AppImage)",
      artifacts.length > 0,
      artifacts.length > 0
        ? `found: ${artifacts
            .map((artifact) => path.relative(process.cwd(), artifact))
            .join(", ")}`
        : "no distributable artifact found in dist/"
    );
  }

  // (d) package.json parses and names the fork
  let packageName = null;
  try {
    const raw = fs.readFileSync(path.resolve("package.json"), "utf8");
    packageName = JSON.parse(raw).name;
  } catch (error) {
    check("package.json parses", false, error.message);
  }

  if (packageName !== null) {
    check("package.json parses", true);
    check(
      `package.json name is "${EXPECTED_PACKAGE_NAME}"`,
      packageName === EXPECTED_PACKAGE_NAME,
      `got: "${packageName}"`
    );
  }

  if (failures.length > 0) {
    console.log(`\nSmoke test FAILED with ${failures.length} problem(s):`);
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    "\nSmoke test PASSED: bundles, updater feed, artifacts and package.json are OK."
  );
  process.exit(0);
}

main();
