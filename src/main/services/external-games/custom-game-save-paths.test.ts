import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CloudSaveCustomPath, GameShop } from "@types";
import type { CloudSaveCustomPathContext } from "../cloud-save/custom-path.js";

import {
  registerSavePathsForCustomGame,
  type CustomGameSavePathDeps,
} from "./custom-game-save-paths.js";

const customPathContext: CloudSaveCustomPathContext = {
  platform: "linux",
  homeDir: "/home/tester",
};

interface RegistrationRecorder {
  deps: CustomGameSavePathDeps;
  state: () => {
    registered: Array<[GameShop, string, CloudSaveCustomPath[]]>;
    warnings: string[];
    statRequests: string[];
  };
}

const createDeps = (options: {
  existingPaths?: Record<string, "file" | "dir">;
  canonicalizeError?: (savePath: string) => Error | null;
}): RegistrationRecorder => {
  const registered: Array<[GameShop, string, CloudSaveCustomPath[]]> = [];
  const warnings: string[] = [];
  const statRequests: string[] = [];
  const existingPaths = options.existingPaths ?? {};

  return {
    deps: {
      getCustomPathContext: async () => customPathContext,
      statPath: async (savePath) => {
        statRequests.push(savePath);
        return existingPaths[savePath] ?? null;
      },
      canonicalize: async (savePath, context, kind) => {
        const error = options.canonicalizeError?.(savePath);
        if (error) throw error;
        return {
          rawPath: `<custom><linux><absolute>${savePath}`,
          path: savePath,
          platform: context.platform,
          kind,
        };
      },
      registerCloudSaveCustomPaths: async (shop, objectId, customPaths) => {
        registered.push([shop, objectId, customPaths]);
      },
      warn: (message) => {
        warnings.push(message);
      },
    },
    state: () => ({ registered, warnings, statRequests }),
  };
};

describe("custom game save path registration", () => {
  it("registers existing paths as canonical custom paths", async () => {
    const savesDir = "/home/tester/.local/share/Hytale/UserData/Saves";
    const settingsFile = "/home/tester/.local/share/Hytale/Settings.json";
    const recorder = createDeps({
      existingPaths: { [savesDir]: "dir", [settingsFile]: "file" },
    });

    const registered = await registerSavePathsForCustomGame(
      "custom",
      "object-id",
      [savesDir, settingsFile],
      recorder.deps
    );

    const { registered: calls, warnings } = recorder.state();
    assert.equal(warnings.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "custom");
    assert.equal(calls[0][1], "object-id");
    assert.deepEqual(
      calls[0][2].map((customPath) => customPath.rawPath),
      [
        `<custom><linux><absolute>${savesDir}`,
        `<custom><linux><absolute>${settingsFile}`,
      ]
    );
    assert.equal(registered.length, 2);
    assert.equal(registered[0].kind, "dir");
    assert.equal(registered[1].kind, "file");
  });

  it("skips non-existent paths with a warning but keeps the rest", async () => {
    const savesDir = "/home/tester/.local/share/Hytale/UserData/Saves";
    const missingPath = "/home/tester/nowhere";
    const recorder = createDeps({
      existingPaths: { [savesDir]: "dir" },
    });

    const registered = await registerSavePathsForCustomGame(
      "custom",
      "object-id",
      [missingPath, savesDir],
      recorder.deps
    );

    const { registered: calls, warnings } = recorder.state();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /non-existent/);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0][2].map((customPath) => customPath.path),
      [savesDir]
    );
    assert.equal(registered.length, 1);
  });

  it("does not register anything when the save path array is empty", async () => {
    const recorder = createDeps({});

    assert.deepEqual(
      await registerSavePathsForCustomGame(
        "custom",
        "object-id",
        [],
        recorder.deps
      ),
      []
    );
    assert.deepEqual(
      await registerSavePathsForCustomGame(
        "custom",
        "object-id",
        undefined,
        recorder.deps
      ),
      []
    );
    assert.deepEqual(
      await registerSavePathsForCustomGame(
        "custom",
        "object-id",
        [null, "", "   "],
        recorder.deps
      ),
      []
    );

    const { registered, warnings, statRequests } = recorder.state();
    assert.deepEqual(registered, []);
    assert.deepEqual(warnings, []);
    assert.deepEqual(statRequests, []);
  });

  it("skips paths the canonicalizer rejects and warns", async () => {
    const protectedPath = "/proc/self/mem";
    const savesDir = "/home/tester/.local/share/Hytale/UserData/Saves";
    const recorder = createDeps({
      existingPaths: { [protectedPath]: "dir", [savesDir]: "dir" },
      canonicalizeError: (savePath) =>
        savePath === protectedPath
          ? new Error("cloud_save_custom_path_protected")
          : null,
    });

    const registered = await registerSavePathsForCustomGame(
      "custom",
      "object-id",
      [protectedPath, savesDir],
      recorder.deps
    );

    const { registered: calls, warnings } = recorder.state();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Failed to register/);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0][2].map((customPath) => customPath.path),
      [savesDir]
    );
    assert.equal(registered.length, 1);
  });
});
