import react from "@vitejs/plugin-react";
import {
  defineConfig,
  externalizeDepsPlugin,
  loadEnv,
  swcPlugin,
} from "electron-vite";
import JavaScriptObfuscator from "javascript-obfuscator";
import { resolve } from "path";
import { transformWithEsbuild, type Plugin } from "vite";
import svgr from "vite-plugin-svgr";

const mangleIdentifiers = (): Plugin => ({
  name: "hydra:mangle-identifiers",
  apply: "build",
  renderChunk: async (code, chunk) => {
    const result = await transformWithEsbuild(code, chunk.fileName, {
      loader: "js",
      format: "esm",
      charset: "utf8",
      minify: true,
    });

    return { code: result.code, map: null };
  },
});

const buildSeed = Math.floor(Math.random() * 2 ** 31);

const obfuscate = (): Plugin => ({
  name: "hydra:obfuscate",
  apply: "build",
  generateBundle: (_options, bundle) => {
    for (const file of Object.values(bundle)) {
      if (file.type !== "chunk") continue;

      file.code = JavaScriptObfuscator.obfuscate(file.code, {
        target: "node",
        seed: buildSeed,
        compact: true,
        simplify: true,
        identifierNamesGenerator: "mangled",
        renameGlobals: false,
        stringArray: true,
        stringArrayThreshold: 0.8,
        stringArrayEncoding: ["base64"],
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayIndexShift: true,
        splitStrings: false,
        numbersToExpressions: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        debugProtection: false,
        disableConsoleOutput: false,
        sourceMap: false,
      }).getObfuscatedCode();
    }
  },
});

export default defineConfig(({ mode }) => {
  loadEnv(mode);

  const isProduction = mode === "production";
  const minify = isProduction ? "esbuild" : false;

  return {
    main: {
      build: {
        // The lean fork never emits sourcemaps, in any mode.
        sourcemap: false,
        minify,
      },
      resolve: {
        alias: {
          "@main": resolve("src/main"),
          "@locales": resolve("src/locales"),
          "@resources": resolve("resources"),
          "@shared": resolve("src/shared"),
          "@shared/*": resolve("src/shared"),
        },
      },
      plugins: [
        externalizeDepsPlugin(),
        swcPlugin(),
        // The upstream original ships `angleIdentifiers(), obfuscate()]`
        // here — an undefined identifier with a stray bracket that fails
        // to even parse; this port fixes it to mangleIdentifiers().
        ...(isProduction ? [mangleIdentifiers(), obfuscate()] : []),
      ],
    },
    preload: {
      build: {
        minify,
      },
      plugins: [
        externalizeDepsPlugin(),
        ...(isProduction ? [obfuscate()] : []),
      ],
    },
    renderer: {
      build: {
        sourcemap: false,
        minify,
      },
      esbuild: {
        keepNames: !isProduction,
      },
      css: {
        preprocessorOptions: {
          scss: {
            api: "modern",
          },
        },
      },
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared"),
          "@shared/*": resolve("src/shared"),
        },
      },
      plugins: [svgr(), react()],
    },
  };
});
