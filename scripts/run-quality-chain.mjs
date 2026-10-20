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
 * --fast skips the test-suite stage (use only when iterating on docs).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

const STAGES = [
  {
    id: "1/7",
    title: "type graph — main process",
    detail: "typecheck:node (tsc --noEmit)",
    run: () => yarn("typecheck:node"),
  },
  {
    id: "2/7",
    title: "type graph — renderer + preload",
    detail: "typecheck:web (tsc --noEmit)",
    run: () => yarn("typecheck:web"),
  },
  {
    id: "3/7",
    title: "static analysis",
    detail: "eslint (0 errors required)",
    run: () => yarn("lint"),
  },
  {
    id: "4/7",
    title: "locale parity (en + pt-BR)",
    detail: "flattened key sets must be identical",
    run: i18nParity,
  },
  {
    id: "5/7",
    title: "renderer ↔ preload drift",
    detail: "check:ota-bridge --base local",
    run: () => yarn("check:ota-bridge"),
  },
  ...(FAST
    ? []
    : [
        {
          id: "6/7",
          title: "unit + chain scenarios",
          detail: "yarn test (incl. src/test-chains puzzle)",
          run: () => yarn("test"),
        },
      ]),
  {
    id: FAST ? "6/6" : "7/7",
    title: "formatting",
    detail: "prettier --check .",
    run: () => yarn("format-check"),
  },
];

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
