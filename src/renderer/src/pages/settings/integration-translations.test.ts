import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Google Drive is the only account integration left in Hydra Plus (the paid
 * download services were removed). These tests keep guarding the
 * integration copy: every displayed key must exist in every desktop locale
 * and must be actually translated in pt-BR.
 */
const INTEGRATION_SOURCE_FILES = [
  "src/renderer/src/helpers/google-drive-connect.ts",
  "src/renderer/src/pages/game-details/modals/game-options-modal/drive-connect-cta.tsx",
  "src/renderer/src/pages/settings/settings-context-cloud.tsx",
] as const;

const INTEGRATION_KEY_NAMESPACE_FALLBACKS = ["settings", "game_details"];

const readTranslation = (locale: string) => {
  const translationPath = path.resolve(
    process.cwd(),
    "src/locales",
    locale,
    "translation.json"
  );

  return JSON.parse(fs.readFileSync(translationPath, "utf8")) as Record<
    string,
    Record<string, string>
  >;
};

const resolveIntegrationValue = (
  translation: Record<string, Record<string, string>>,
  key: string
): string | undefined => {
  for (const namespace of INTEGRATION_KEY_NAMESPACE_FALLBACKS) {
    const value = translation[namespace]?.[key];
    if (typeof value === "string") return value;
  }

  return undefined;
};

const getIntegrationKeys = () => {
  const keys = new Set<string>();
  const integrationKeyPattern = /["'](google_drive_[a-z0-9_]+)["']/g;

  for (const sourceFile of INTEGRATION_SOURCE_FILES) {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), sourceFile),
      "utf8"
    );

    for (const match of source.matchAll(integrationKeyPattern)) {
      keys.add(match[1]);
    }
  }

  return keys;
};

describe("integration translations", () => {
  it("defines every displayed integration key in every desktop locale", () => {
    const localesPath = path.resolve(process.cwd(), "src/locales");
    const locales = fs.readdirSync(localesPath);
    const integrationKeys = getIntegrationKeys();

    assert.ok(
      integrationKeys.size > 0,
      "no integration keys found in the scanned source files"
    );

    for (const locale of locales) {
      const translationPath = path.join(
        localesPath,
        locale,
        "translation.json"
      );
      if (!fs.existsSync(translationPath)) continue;

      const translation = readTranslation(locale);

      for (const key of integrationKeys) {
        assert.equal(
          typeof resolveIntegrationValue(translation, key),
          "string",
          `${locale} is missing integration key ${key}`
        );
        assert.ok(
          resolveIntegrationValue(translation, key)?.trim(),
          `${locale} has an empty integration key ${key}`
        );
      }
    }
  });

  it("keeps every integration copy translated in pt-BR", () => {
    const english = readTranslation("en");
    const portuguese = readTranslation("pt-BR");

    for (const key of getIntegrationKeys()) {
      const englishValue = resolveIntegrationValue(english, key);
      const portugueseValue = resolveIntegrationValue(portuguese, key);

      assert.equal(
        typeof portugueseValue,
        "string",
        `pt-BR is missing integration key ${key}`
      );
      assert.ok(
        portugueseValue?.trim(),
        `pt-BR has an empty integration key ${key}`
      );
      assert.notEqual(
        portugueseValue,
        englishValue,
        `integration key ${key} still uses the English copy in pt-BR`
      );
    }
  });
});
