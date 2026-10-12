import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";

type TestGame = {
  id: string;
  objectId: string;
  shop: string;
  title: string;
};

const hiddenGame: TestGame = {
  id: "steam:123",
  objectId: "123",
  shop: "steam",
  title: "Hidden game",
};
const requireModule = createRequire(import.meta.url);
const noop = () => {};
const translate = (key: string) => key;

async function renderLibrary(
  t: TestContext,
  options: { readHidden?: () => Promise<TestGame[]> } = {}
) {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://hydra.test/library?collection=__hidden__",
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    ResizeObserver: class {
      observe = noop;
      disconnect = noop;
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previousGlobals = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  dom.window.HTMLElement.prototype.scrollTo = noop;
  dom.window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 900 }) as DOMRect;

  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  let readHidden = options.readHidden ?? (async () => [hiddenGame]);
  let rowCount = 0;
  const updateLibrary = async () => {};
  const searchParams = new URLSearchParams("collection=__hidden__");
  const virtualizer = {
    measure: noop,
    getTotalSize: () => rowCount * 300,
    getVirtualItems: () =>
      Array.from({ length: rowCount }, (_, index) => ({
        key: index,
        index,
        start: index * 300,
      })),
  };
  Object.defineProperty(dom.window, "electron", {
    value: {
      getHiddenLibrary: () => readHidden(),
      onLibraryBatchComplete: () => noop,
    },
  });

  const gameCard = ({ game }: { game: TestGame }) =>
    React.createElement("span", { "data-hidden-game": game.id }, game.title);
  const stubs: Record<string, unknown> = {
    "@tanstack/react-virtual": {
      useVirtualizer: ({ count }: { count: number }) => {
        rowCount = count;
        return virtualizer;
      },
    },
    "@renderer/hooks": {
      useLibrary: () => ({ library: [], updateLibrary }),
      useAppDispatch: () => noop,
      useAppSelector: (select: (state: unknown) => unknown) =>
        select({ library: { searchQuery: "" } }),
    },
    "@renderer/features": {
      selectIsLibraryLoading: () => false,
      setHeaderTitle: noop,
    },
    "@primer/octicons-react": Object.fromEntries(
      [
        "HeartIcon",
        "TelescopeIcon",
        "EyeClosedIcon",
        "SearchIcon",
        "SyncIcon",
      ].map((name) => [name, () => null])
    ),
    "react-i18next": { useTranslation: () => ({ t: translate }) },
    "@shared": {
      removeDiacritics: (value: string) => value,
    },
    "@renderer/components": {
      GameContextMenu: () => null,
    },
    "@renderer/helpers": {
      isGameInstalled: () => false,
      sortLibraryGames: (games: TestGame[]) => games,
    },
    "react-router-dom": {
      useSearchParams: () => [searchParams, noop],
    },
    "./library-game-card": { LibraryGameCard: gameCard },
    "./library-game-card-large": { LibraryGameCardLarge: gameCard },
    "./view-options": { ViewOptions: () => null },
    "./filter-options": { FilterOptions: () => null },
    "./category-filter": { CategoryFilter: () => null },
    "./installed-filter": { InstalledFilter: () => null },
    "./platform-filter": { PlatformFilter: () => null },
    "./source-filter": { SourceFilter: () => null },
    "./library-games-skeleton": { LibraryGamesSkeleton: () => null },
    "./library-category": {
      categoryShowsPlatforms: () => false,
      categoryShowsSources: () => false,
      filterLibraryGames: (games: TestGame[]) => games,
      getLibraryFilterOptions: () => ({ platforms: [], hasSteamGames: false }),
      readStoredLibraryFilters: () => ({ category: "all", sources: [] }),
    },
    "@renderer/session-state": {
      LIBRARY_INSTALLED_ONLY_STORAGE_KEY: "library-installed-only",
      LIBRARY_PLATFORMS_STORAGE_KEY: "library-platforms",
      LIBRARY_SOURCES_STORAGE_KEY: "library-sources",
    },
  };
  const filename = path.resolve(
    process.cwd(),
    "src/renderer/src/pages/library/library.tsx"
  );
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: { default?: React.ComponentType } = {};
  new Function("exports", "require", outputText)(exports, (name: string) => {
    if (name.endsWith(".scss")) return {};
    return stubs[name] ?? requireModule(name);
  });
  const Library = exports.default!;
  await act(async () => root.render(React.createElement(Library)));
  await act(async () => {});

  return {
    text: () => dom.window.document.body.textContent ?? "",
    games: () =>
      Array.from(
        dom.window.document.querySelectorAll("[data-hidden-game]")
      ).map((element) => element.textContent),
    setHiddenRead: (nextRead: () => Promise<TestGame[]>) => {
      readHidden = nextRead;
    },
    notifyVisibilityChange: async () => {
      await act(async () => {
        dom.window.dispatchEvent(
          new dom.window.Event("hydra:game-visibility-updated")
        );
      });
    },
  };
}

describe("hidden library local reads", () => {
  it("shows the locally concealed games on mount", async (t) => {
    const page = await renderLibrary(t);
    assert.deepEqual(page.games(), [hiddenGame.title]);
  });

  it("refreshes the hidden list when a visibility change is notified", async (t) => {
    const page = await renderLibrary(t);
    page.setHiddenRead(async () => []);
    await page.notifyVisibilityChange();
    assert.deepEqual(page.games(), []);
  });

  it("falls back to an empty list when the local read fails", async (t) => {
    const page = await renderLibrary(t, {
      readHidden: async () => {
        throw new Error("local read failed");
      },
    });
    assert.deepEqual(page.games(), []);
  });
});
