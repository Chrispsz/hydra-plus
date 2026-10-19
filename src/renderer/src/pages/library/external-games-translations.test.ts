import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Every string the external-games import wizard (custom game modal) renders
 * lives in the "sidebar" namespace. This guard keeps en and pt-BR in sync.
 */
const EXTERNAL_GAMES_SIDEBAR_KEYS = [
  "custom_game_modal_detect_title",
  "custom_game_modal_detect_hint",
  "custom_game_modal_scan_system",
  "custom_game_modal_scanning",
  "custom_game_modal_scan_failed",
  "custom_game_modal_scan_retry",
  "custom_game_modal_scan_no_results",
  "custom_game_modal_scan_results",
  "custom_game_modal_source_hytale",
  "custom_game_modal_source_linux_app",
  "custom_game_modal_source_windows_app",
  "custom_game_modal_saves_detected",
  "custom_game_modal_cloud_saves_title",
  "custom_game_modal_cloud_saves_hint",
  "custom_game_modal_add_save_folder",
  "custom_game_modal_add_save_file",
  "custom_game_modal_remove_save_path",
  "custom_game_modal_auto_sync_label",
  "custom_game_modal_auto_sync_hint",
  "custom_game_modal_auto_sync_failed",
] as const;

/**
 * Brand labels stay identical across locales: "Hytale" is the game's proper
 * name in both English and Brazilian Portuguese.
 */
const SKIP_DIFF_SIDEBAR_KEYS = ["custom_game_modal_source_hytale"] as const;

const EXPECTED_EN_COPY: Record<string, string> = {
  custom_game_modal_detect_title: "Detect installed games",
  custom_game_modal_detect_hint:
    "Detect Hytale and other installed apps to fill the form below automatically.",
  custom_game_modal_scan_system: "Scan system",
  custom_game_modal_scanning: "Scanning installed games...",
  custom_game_modal_scan_failed: "Could not scan for installed games",
  custom_game_modal_scan_retry: "Retry",
  custom_game_modal_scan_no_results:
    "No installed games were detected. You can still add one manually below.",
  custom_game_modal_scan_results: "Games detected: {{count}}",
  custom_game_modal_source_hytale: "Hytale",
  custom_game_modal_source_linux_app: "Linux app",
  custom_game_modal_source_windows_app: "Windows app",
  custom_game_modal_saves_detected: "Saves detected",
  custom_game_modal_cloud_saves_title: "Cloud saves",
  custom_game_modal_cloud_saves_hint:
    "Folders and files listed here are synced to your Google Drive cloud saves.",
  custom_game_modal_add_save_folder: "Add folder",
  custom_game_modal_add_save_file: "Add file",
  custom_game_modal_remove_save_path: "Remove save path",
  custom_game_modal_auto_sync_label: "Enable automatic cloud sync",
  custom_game_modal_auto_sync_hint:
    "Saves sync when you start and close the game.",
  custom_game_modal_auto_sync_failed:
    "Game added, but automatic cloud sync could not be enabled",
};

const EXPECTED_PT_BR_COPY: Record<string, string> = {
  custom_game_modal_detect_title: "Detectar jogos instalados",
  custom_game_modal_detect_hint:
    "Detecte o Hytale e outros aplicativos instalados para preencher o formulário abaixo automaticamente.",
  custom_game_modal_scan_system: "Escanear o sistema",
  custom_game_modal_scanning: "Procurando jogos instalados...",
  custom_game_modal_scan_failed: "Não foi possível procurar jogos instalados",
  custom_game_modal_scan_retry: "Tentar novamente",
  custom_game_modal_scan_no_results:
    "Nenhum jogo instalado foi detectado. Você ainda pode adicionar um manualmente abaixo.",
  custom_game_modal_scan_results: "Jogos detectados: {{count}}",
  custom_game_modal_source_hytale: "Hytale",
  custom_game_modal_source_linux_app: "Aplicativo Linux",
  custom_game_modal_source_windows_app: "Aplicativo Windows",
  custom_game_modal_saves_detected: "Saves detectados",
  custom_game_modal_cloud_saves_title: "Saves na nuvem",
  custom_game_modal_cloud_saves_hint:
    "As pastas e arquivos listados aqui são sincronizados com os seus saves na nuvem no Google Drive.",
  custom_game_modal_add_save_folder: "Adicionar pasta",
  custom_game_modal_add_save_file: "Adicionar arquivo",
  custom_game_modal_remove_save_path: "Remover caminho de save",
  custom_game_modal_auto_sync_label: "Ativar sincronização automática na nuvem",
  custom_game_modal_auto_sync_hint:
    "Os saves sincronizam ao iniciar e fechar o jogo.",
  custom_game_modal_auto_sync_failed:
    "Jogo adicionado, mas não foi possível ativar a sincronização automática na nuvem",
};

const readSidebar = (locale: string) => {
  const translationPath = path.resolve(
    process.cwd(),
    "src/locales",
    locale,
    "translation.json"
  );
  return JSON.parse(fs.readFileSync(translationPath, "utf8")).sidebar;
};

describe("External games import wizard translations", () => {
  it("defines every wizard string in every desktop locale", () => {
    const localesPath = path.resolve(process.cwd(), "src/locales");

    for (const locale of fs.readdirSync(localesPath)) {
      const translationPath = path.join(
        localesPath,
        locale,
        "translation.json"
      );
      if (!fs.existsSync(translationPath)) continue;

      const sidebar = JSON.parse(
        fs.readFileSync(translationPath, "utf8")
      ).sidebar;

      for (const key of EXTERNAL_GAMES_SIDEBAR_KEYS) {
        assert.equal(
          typeof sidebar?.[key],
          "string",
          `${locale} is missing sidebar.${key}`
        );
        assert.ok(sidebar[key].trim(), `${locale} has an empty sidebar.${key}`);
      }
    }
  });

  it("keeps the agreed English and Brazilian Portuguese copy", () => {
    const en = readSidebar("en");
    const ptBr = readSidebar("pt-BR");

    for (const key of EXTERNAL_GAMES_SIDEBAR_KEYS) {
      assert.equal(
        en[key],
        EXPECTED_EN_COPY[key],
        `en sidebar.${key} drifted from the agreed copy`
      );
      assert.equal(
        ptBr[key],
        EXPECTED_PT_BR_COPY[key],
        `pt-BR sidebar.${key} drifted from the agreed copy`
      );
    }
  });

  it("translates the prose to pt-BR, keeping brand labels shared", () => {
    const en = readSidebar("en");
    const ptBr = readSidebar("pt-BR");

    for (const key of EXTERNAL_GAMES_SIDEBAR_KEYS) {
      if (
        SKIP_DIFF_SIDEBAR_KEYS.includes(
          key as (typeof SKIP_DIFF_SIDEBAR_KEYS)[number]
        )
      ) {
        continue;
      }

      assert.notEqual(
        en[key],
        ptBr[key],
        `sidebar.${key} is untranslated in pt-BR`
      );
    }
  });
});
