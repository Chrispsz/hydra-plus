#!/usr/bin/env node
/**
 * The full "puzzle" quality chain for Hydra Plus.
 *
 * One command, one verdict: every stage feeds the picture of the release.
 * All stages run even when an earlier one fails, so the board below always
 * shows the whole puzzle — then the process exits non-zero if any piece is
 * broken.
 *
 *   node scripts/run-quality-chain.mjs [--fast]
 *
 * Pieces (in order):
 *   1. type graph — main process        (tsc --noEmit)
 *   2. type graph — renderer + preload  (tsc --noEmit)
 *   3. static analysis                  (eslint, 0 errors required)
 *   4. locale parity                    (en ↔ pt-BR flattened key sets)
 *   5. renderer ↔ preload drift         (check:ota-bridge --base local)
 *   6. stylesheet compilation           (sass over every scss root)
 *   7. unit + chain scenarios           (node --test, incl. src/test-chains)
 *   8. production build + artifact smoke (electron-vite build → smoke-launch)
 *   9. formatting                       (prettier --check .)
 *
 * --fast skips stages 7 and 8 (use only when iterating on docs).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(fs.realpathSync(new URL(".", import.meta.url)), "..");

const FAST = process.argv.includes("--fast");

const yarn = (script) => {
  const result = spawnSync("corepack", ["yarn", "run", script], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

const nodeScript = (relativePath, args = []) => {
  const result = spawnSync("node", [path.join(REPO, relativePath), ...args], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

const flattenLocale = (node, prefix = "") =>
  Object.entries(node).reduce(
    (acc, [key, value]) =>
      typeof value === "object" && value
        ? Object.assign(acc, flattenLocale(value, prefix + key + "."))
        : Object.assign(acc, { [prefix + key]: value }),
    {}
  );

const i18nParity = () => {
  const locales = ["en", "pt-BR"];
  const keysByLocale = {};
  for (const locale of locales) {
    const file = path.join(REPO, "src", "locales", locale, "translation.json");
    const tree = JSON.parse(fs.readFileSync(file, "utf8"));
    keysByLocale[locale] = flattenLocale(tree);
  }
  const enKeys = new Set(Object.keys(keysByLocale.en));
  const ptKeys = new Set(Object.keys(keysByLocale["pt-BR"]));
  const missingInPt = [...enKeys].filter((key) => !ptKeys.has(key));
  const missingInEn = [...ptKeys].filter((key) => !enKeys.has(key));
  const lines = [`en: ${enKeys.size} keys | pt-BR: ${ptKeys.size} keys`];
  const ok =
    enKeys.size === ptKeys.size &&
    missingInPt.length === 0 &&
    missingInEn.length === 0;
  if (!ok) {
    lines.push(`missingInPt: ${JSON.stringify(missingInPt)}`);
    lines.push(`missingInEn: ${JSON.stringify(missingInEn)}`);
  }
  return { code: ok ? 0 : 1, output: lines.join("\n") };
};

/**
 * SCSS is not covered by tsc/eslint — this piece compiles every stylesheet
 * root (directory mode skips _partials) the same way electron-vite would,
 * so a broken token/import fails the chain before the build stage.
 */
const scssCompilation = () => {
  const destination = fs
    .mkdtempSync(path.join(os.tmpdir(), "hydra-scss-chain-"))
    .replaceAll("\\", "/");
  try {
    const sassBinary = path.join("node_modules", ".bin", "sass");
    const result = spawnSync(
      sassBinary,
      ["--no-source-map", "--quiet", `src/renderer/src:${destination}`],
      { cwd: REPO, encoding: "utf8", maxBuffer: 1024 * 1024 * 32 }
    );
    const compiled = fs.existsSync(destination)
      ? fs
          .readdirSync(destination, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
          .length
      : 0;
    const lines = [
      `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
      `scss roots compiled: ${compiled} (sanity floor: 80)`,
    ];
    const ok = (result.status ?? 1) === 0 && compiled >= 80;
    return { code: ok ? 0 : 1, output: lines.filter(Boolean).join("\n") };
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
};

/**
 * The definitive "it compiles as a product" piece: electron-vite production
 * build followed by the post-build smoke (bundles exist, preload is where
 * the runtime expects it, no upstream auto-update feed leaked into main).
 */
const productionBuildAndSmoke = () => {
  const compile = yarn("compile");
  if (compile.code !== 0) return compile;
  const smoke = nodeScript(path.join("scripts", "smoke-launch.cjs"), [
    "--bundles-only",
  ]);
  return {
    code: smoke.code,
    output: `${compile.output}\n${smoke.output}`,
  };
};

const HEAVY_STAGES = FAST
  ? []
  : [
      {
        title: "unit + chain scenarios",
        detail: "yarn test (incl. src/test-chains puzzle)",
        run: () => yarn("test"),
      },
      {
        title: "production build + artifact smoke",
        detail: "electron-vite build → scripts/smoke-launch.cjs --bundles-only",
        run: productionBuildAndSmoke,
      },
    ];

const STAGES = [
  {
    title: "type graph — main process",
    detail: "typecheck:node (tsc --noEmit)",
    run: () => yarn("typecheck:node"),
  },
  {
    title: "type graph — renderer + preload",
    detail: "typecheck:web (tsc --noEmit)",
    run: () => yarn("typecheck:web"),
  },
  {
    title: "static analysis",
    detail: "eslint (0 errors required)",
    run: () => yarn("lint"),
  },
  {
    title: "locale parity (en + pt-BR)",
    detail: "flattened key sets must be identical",
    run: i18nParity,
  },
  {
    title: "renderer ↔ preload drift",
    detail: "check:ota-bridge --base local",
    run: () => yarn("check:ota-bridge"),
  },
  {
    title: "stylesheet compilation",
    detail: "sass directory mode over every scss root",
    run: scssCompilation,
  },
  ...HEAVY_STAGES,
  {
    title: "formatting",
    detail: "prettier --check .",
    run: () => yarn("format-check"),
  },
].map((stage, index, all) => ({ ...stage, id: `${index + 1}/${all.length}` }));

const tail = (text, lines = 12) =>
  text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-lines)
    .join("\n");

let failed = 0;
const results = [];
for (const stage of STAGES) {
  process.stdout.write(`  ${stage.id} ${stage.title} … `);
  const startedAt = Date.now();
  const result = stage.run();
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const ok = result.code === 0;
  if (!ok) failed += 1;
  results.push({ stage, ok, result, seconds });
  process.stdout.write(`${ok ? "✓" : "✗"} (${seconds}s)\n`);
  if (!ok) {
    process.stdout.write(
      `\n    ── ${stage.detail} ──\n${tail(result.output)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n")}\n\n`
    );
  }
}

const board = results
  .map(
    ({ stage, ok, seconds }) =>
      `  ${ok ? "🟩" : "🟥"} ${stage.id.padEnd(5)} ${stage.title.padEnd(
        34
      )} ${seconds}s`
  )
  .join("\n");

process.stdout.write(
  `\nhydra-plus quality chain — ${failed === 0 ? "PUZZLE COMPLETE ✅" : "PUZZLE BROKEN ❌"}\n${board}\n`
);

process.exitCode = failed === 0 ? 0 : 1;
