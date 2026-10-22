/**
 * CHAIN E — "stability: launch guards, kill trees and extraction ghosts".
 *
 * One continuous scenario per sub-test: the decision logic behind the F1
 * stability commits (230d6d6 and d815639) was extracted into small pure
 * modules (launch-guard, compat-process-kill, extraction-child-registry,
 * download-registry-guards, kill-command); this chain drives those real
 * modules end-to-end — the kill-tree and extraction scenarios against
 * REAL operating-system processes (POSIX; this sandbox is Linux).
 *
 * Stage map:
 *   1. DOUBLE-LAUNCH GUARD  tryAcquireLaunchSlot / releaseLaunchSlot
 *                 (launch-guard.ts, moved verbatim from launch-game.ts):
 *                 rapid duplicate requests collapse into one pipeline,
 *                 the slot comes back on the success AND the failure
 *                 path (the finally contract), the completion timestamp
 *                 feeds the cleanup skip, a leaked slot is taken over
 *                 exactly after the 15min stale valve, and in-flight
 *                 slots never collide across games.
 *   2. STALE-CLEANUP SKIP   shouldSkipStaleCompatibilityCleanup with
 *                 injected `now`: a running game or a launch that
 *                 finished <10s ago keeps compatibility cleanup away;
 *                 once the watcher window passes, cleanup proceeds.
 *   3. KILL-TREE ESCALATION terminateStaleProcesses / waitForProcesses-
 *                 toExit / isProcessAlive (compat-process-kill.ts) over
 *                 REAL spawned processes: SIGTERM clears a stale group
 *                 within the grace period, a TERM-ignoring process
 *                 survives the grace and dies to the caller's SIGKILL
 *                 (the launch-game.ts escalation shape), and the poll
 *                 loop is pinned deterministically through its
 *                 injectable probe.
 *   4. EXTRACTION GHOSTS    ChildProcessRegistry (extraction-child-
 *                 registry.ts, the Set + POSIX group kill moved
 *                 verbatim from 7zip.ts): cancelAll takes down every
 *                 registered detached child, natural exits drop the
 *                 size, and an empty registry is a no-op.
 *   5. DOWNLOAD GHOSTS      shouldSkipRegistryRewrite / shouldAbort-
 *                 ProgressRewrite / resolveResetStatus (download-
 *                 registry-guards.ts, moved verbatim from game-files-
 *                 manager.ts): a download removed (or purged) during
 *                 extraction never comes back as a ghost registry entry,
 *                 and a failed extraction resets a live download to
 *                 its honest status (seeding/complete/previous).
 *   6. KILL COMMAND         buildKillCommand (kill-command.ts, moved
 *                 verbatim from close-game.ts): /T /F tree-kill on
 *                 Windows, plain kill -9 everywhere else.
 *
 * Headless boundaries (honesty over coverage theater):
 *   - launch-game.ts, 7zip.ts, game-files-manager.ts and close-game.ts
 *     import electron/LevelDB at module load, so the chains exercise
 *     the extracted pure modules directly — the call sites only glue
 *     them to the Electron services, and their warn/info log lines stay
 *     at the call sites untouched.
 *   - download-registry-guards.ts imports the `Downloader` enum from
 *     `@shared/constants`, a runtime alias ts-node/esm cannot resolve;
 *     the alias-registry hook (same as proton-chain) is registered
 *     before the dynamic import so the REAL enum values (Torrent = 1)
 *     drive the assertions.
 *   - process-watcher.ts (980b8ec: playtime flush on quit) and the
 *     native-addon worker timeout live behind `electron` and the
 *     built .node binary — not importable headless; documented in
 *     docs/smoke-test.md territory, reported in the worklog.
 *   - drive-client timeouts (a3a92bc) and the ludusavi/hoster 30s
 *     caps (4e9f6b4) are audit-only: their value-import graphs pull
 *     axios/electron chains unsuited for this chain's hermetic budget.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { register } from "node:module";
import { after, describe, it } from "node:test";

import type { Download } from "@types";
import { Downloader } from "../shared/constants.js";
import {
  ACTIVE_LAUNCH_STALE_MS,
  RECENT_LAUNCH_SKIP_MS,
  releaseLaunchSlot,
  shouldSkipStaleCompatibilityCleanup,
  tryAcquireLaunchSlot,
} from "../main/helpers/launch-guard.js";
import {
  isProcessAlive,
  terminateStaleProcesses,
  waitForProcessesToExit,
} from "../main/helpers/compat-process-kill.js";
import { ChildProcessRegistry } from "../main/helpers/extraction-child-registry.js";
import { buildKillCommand } from "../main/helpers/kill-command.js";

// ts-node/esm cannot resolve the tsconfig `paths` aliases that
// download-registry-guards.ts uses for its runtime import of
// `@shared/constants`. This resolve hook (active for dynamic imports
// made after this call) rewrites the two aliases to real files and
// delegates everything else to the ts-node loader.
register(new URL("./helpers/alias-registry.mjs", import.meta.url));

const GAME_KEY = "steam::chain-e-stability";
const T0 = 1_700_000_000_000;

/** Every child this chain spawns, reaped by the after() hook below. */
const spawnedChildren: ChildProcess[] = [];

const spawnDetachedSleep = (seconds: number): ChildProcess => {
  const child = spawn("sleep", [String(seconds)], {
    detached: true,
    stdio: "ignore",
  });
  spawnedChildren.push(child);
  return child;
};

const settle = (ms = 50) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const awaitExit = (child: ChildProcess, timeoutMs = 10_000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    // The exit event was already emitted — the CI runner can reap several
    // spawned children in the same tick, so by the time a sequential loop
    // attaches the next listener the event is gone and a bare once()
    // would hang the whole file. The durable exit fields are the source
    // of truth; the event is not repeatable.
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    // Reffed on purpose: the deadline guarantees this helper ALWAYS
    // settles, instead of the observed CI failure mode — a wedged child
    // stalling the runner ~30s until "Promise resolution is still
    // pending but the event loop has already resolved" cancels the
    // remaining tests in cascade.
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve();
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", onExit);
  });
};

/**
 * Mirrors the launchGame guard wiring (launch-game.ts): acquire → run
 * the pipeline → release in a finally on EVERY exit path, success and
 * failure alike, recording the completion timestamp.
 */
const simulateLaunchPipeline = <T>(
  activeMap: Map<string, number>,
  recentMap: Map<string, number>,
  gameKey: string,
  now: () => number,
  body: () => Promise<T>
): Promise<T | null> => {
  const { acquired } = tryAcquireLaunchSlot(activeMap, gameKey, now());
  if (!acquired) return Promise.resolve(null);

  return body().finally(() => {
    releaseLaunchSlot(activeMap, recentMap, gameKey, now());
  });
};

const buildDownload = (overrides: Partial<Download> = {}): Download => ({
  shop: "steam",
  objectId: "chain-e-ghost",
  uri: "magnet:?xt=urn:btih:chaine",
  folderName: "Chain E Game.zip",
  downloadPath: "/tmp/chain-e-downloads",
  progress: 0.5,
  downloader: Downloader.Torrent,
  bytesDownloaded: 512,
  fileSize: 1024,
  shouldSeed: true,
  status: "active",
  queued: false,
  timestamp: T0,
  extracting: true,
  automaticallyExtract: true,
  automaticallyDeleteArchiveFiles: false,
  ...overrides,
});

after(async () => {
  for (const child of spawnedChildren) {
    // Only children still running need reaping; exited ones already
    // fired their exit event (awaiting it again would never resolve
    // and hang the runner).
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      await awaitExit(child);
    }
  }
});

describe("chain E — stability: launch guards, kill trees and extraction ghosts", () => {
  it("scenario 1: rapid duplicate requests collapse into one launch and the slot always comes back", async () => {
    const activeMap = new Map<string, number>();
    const recentMap = new Map<string, number>();
    const bodies: string[] = [];
    let now = T0;

    const first = await simulateLaunchPipeline(
      activeMap,
      recentMap,
      GAME_KEY,
      () => now,
      async () => {
        bodies.push("first");

        // A second click racing the in-flight pipeline is refused —
        // the whole launch pipeline must not run twice.
        const duplicate = await simulateLaunchPipeline(
          activeMap,
          recentMap,
          GAME_KEY,
          () => now,
          async () => {
            bodies.push("duplicate");
            return "duplicate";
          }
        );
        assert.equal(duplicate, null);
        assert.deepEqual(bodies, ["first"]);
        return "first";
      }
    );
    assert.equal(first, "first");

    // The finally recorded the completion timestamp (the seed of the
    // stale-cleanup skip below).
    assert.ok(recentMap.has(GAME_KEY));
    assert.equal(activeMap.has(GAME_KEY), false);

    // Success path released the slot: the next launch goes through.
    now += 2_000;
    assert.equal(
      await simulateLaunchPipeline(
        activeMap,
        recentMap,
        GAME_KEY,
        () => now,
        async () => "second"
      ),
      "second"
    );

    // Failure path releases the slot too — the finally contract that
    // keeps a thrown pipeline from poisoning the game.
    now += 2_000;
    await assert.rejects(
      simulateLaunchPipeline(
        activeMap,
        recentMap,
        GAME_KEY,
        () => now,
        async () => {
          bodies.push("boom");
          throw new Error("blocked by the cloud save gate");
        }
      ),
      /blocked by the cloud save gate/
    );
    assert.equal(activeMap.has(GAME_KEY), false);

    now += 2_000;
    assert.equal(
      await simulateLaunchPipeline(
        activeMap,
        recentMap,
        GAME_KEY,
        () => now,
        async () => "after-failure"
      ),
      "after-failure"
    );
  });

  it("scenario 1: a refused duplicate never touches the in-flight slot", () => {
    const activeMap = new Map<string, number>();

    assert.deepEqual(tryAcquireLaunchSlot(activeMap, GAME_KEY, T0), {
      acquired: true,
      staleTakeover: false,
    });

    const refused = tryAcquireLaunchSlot(activeMap, GAME_KEY, T0 + 1_000);
    assert.deepEqual(refused, { acquired: false, staleTakeover: false });

    // The guard keeps the ORIGINAL start time: the running pipeline's
    // clock is not reset by the request it refused.
    assert.equal(activeMap.get(GAME_KEY), T0);
  });

  it("scenario 1: a leaked slot is taken over exactly after the 15min stale valve", () => {
    const activeMap = new Map<string, number>();
    tryAcquireLaunchSlot(activeMap, GAME_KEY, T0);

    // 14:59 in flight — still fresh, the duplicate is refused.
    assert.deepEqual(
      tryAcquireLaunchSlot(
        activeMap,
        GAME_KEY,
        T0 + ACTIVE_LAUNCH_STALE_MS - 1_000
      ),
      { acquired: false, staleTakeover: false }
    );

    // Exactly at the window the slot is no longer "fresh" (< 15min),
    // so the safety valve takes over — a leaked guard can never block
    // the game permanently.
    assert.deepEqual(
      tryAcquireLaunchSlot(activeMap, GAME_KEY, T0 + ACTIVE_LAUNCH_STALE_MS),
      { acquired: true, staleTakeover: true }
    );

    // And 15:01 on a fresh leak behaves the same way.
    const secondMap = new Map<string, number>();
    tryAcquireLaunchSlot(secondMap, GAME_KEY, T0);
    const takeover = tryAcquireLaunchSlot(
      secondMap,
      GAME_KEY,
      T0 + ACTIVE_LAUNCH_STALE_MS + 60_000
    );
    assert.deepEqual(takeover, { acquired: true, staleTakeover: true });
    assert.equal(secondMap.get(GAME_KEY), T0 + ACTIVE_LAUNCH_STALE_MS + 60_000);
  });

  it("scenario 1: in-flight slots are per game — another game is never blocked", () => {
    const activeMap = new Map<string, number>();
    const recentMap = new Map<string, number>();
    const hytale = "steam::hytale";
    const stardew = "steam::stardew";

    assert.deepEqual(tryAcquireLaunchSlot(activeMap, hytale, T0), {
      acquired: true,
      staleTakeover: false,
    });
    assert.deepEqual(tryAcquireLaunchSlot(activeMap, stardew, T0), {
      acquired: true,
      staleTakeover: false,
    });

    // Each game is refused by its OWN slot only.
    assert.equal(
      tryAcquireLaunchSlot(activeMap, hytale, T0 + 1_000).acquired,
      false
    );
    assert.equal(
      tryAcquireLaunchSlot(activeMap, stardew, T0 + 1_000).acquired,
      false
    );

    // Releasing one game never frees the other's slot.
    releaseLaunchSlot(activeMap, recentMap, hytale, T0 + 2_000);
    assert.equal(
      tryAcquireLaunchSlot(activeMap, hytale, T0 + 3_000).acquired,
      true
    );
    assert.equal(
      tryAcquireLaunchSlot(activeMap, stardew, T0 + 3_000).acquired,
      false
    );
    assert.ok(recentMap.has(hytale));
    assert.ok(!recentMap.has(stardew));
  });

  it("scenario 1→2: the release of one launch feeds the cleanup skip of the next", () => {
    const activeMap = new Map<string, number>();
    const recentMap = new Map<string, number>();

    const startedAt = T0;
    tryAcquireLaunchSlot(activeMap, GAME_KEY, startedAt);
    releaseLaunchSlot(activeMap, recentMap, GAME_KEY, startedAt + 2_000);

    // releaseLaunchSlot recorded the completion timestamp — the next
    // launch's compatibility cleanup must stay away while the process
    // watcher catches up with the freshly spawned processes.
    const lastLaunchAt = recentMap.get(GAME_KEY);
    assert.equal(lastLaunchAt, startedAt + 2_000);
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: false,
        lastLaunchAt,
        now: lastLaunchAt + 5_000,
      }),
      true
    );
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: false,
        lastLaunchAt,
        now: lastLaunchAt + RECENT_LAUNCH_SKIP_MS,
      }),
      false
    );
  });

  it("scenario 2: cleanup stays away from a game the watcher still tracks", () => {
    // Killing wineserver mid-session risks a corrupted prefix and
    // in-flight saves — a running game wins over any recency math.
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: true,
        lastLaunchAt: undefined,
        now: T0,
      }),
      true
    );
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: true,
        lastLaunchAt: T0 - 60_000,
        now: T0,
      }),
      true
    );
  });

  it("scenario 2: a launch that finished 5s ago keeps cleanup away", () => {
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: false,
        lastLaunchAt: T0 - 5_000,
        now: T0,
      }),
      true
    );
    // One millisecond inside the 10s watcher window is still inside.
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: false,
        lastLaunchAt: T0 - RECENT_LAUNCH_SKIP_MS + 1,
        now: T0,
      }),
      true
    );
  });

  it("scenario 2: cleanup proceeds once the watcher window has passed", () => {
    // Exactly at 10s the launch is no longer "recent" (< RECENT_LAUNCH_SKIP_MS).
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: false,
        lastLaunchAt: T0 - RECENT_LAUNCH_SKIP_MS,
        now: T0,
      }),
      false
    );
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: false,
        lastLaunchAt: T0 - 60_000,
        now: T0,
      }),
      false
    );
    // No recorded launch (first launch ever, or app restart) — nothing
    // to protect.
    assert.equal(
      shouldSkipStaleCompatibilityCleanup({
        gameRunning: false,
        lastLaunchAt: undefined,
        now: T0,
      }),
      false
    );
  });

  it("scenario 3: SIGTERM clears a stale process group within the grace period (real processes)", async () => {
    if (process.platform === "win32") return;

    const sleepers = [spawnDetachedSleep(30), spawnDetachedSleep(30)];
    const pids = sleepers.map((child) => child.pid!);
    await settle();

    const survivors = await terminateStaleProcesses(pids, 2_000, {
      pollIntervalMs: 50,
    });

    // Both processes honored SIGTERM: no survivors for SIGKILL.
    assert.deepEqual(survivors, []);
    for (const pid of pids) {
      assert.equal(isProcessAlive(pid), false);
    }
  });

  it("scenario 3: a TERM-ignoring process survives the grace and dies to the caller's SIGKILL", async () => {
    if (process.platform === "win32") return;

    const child = spawn("sh", ["-c", 'trap "" TERM; sleep 5'], {
      detached: true,
      stdio: "ignore",
    });
    spawnedChildren.push(child);
    const pid = child.pid!;
    await settle();

    // The wrapper swallowed SIGTERM (as a wedged wineserver would).
    const survivors = await terminateStaleProcesses([pid], 600, {
      pollIntervalMs: 50,
    });
    assert.deepEqual(survivors, [pid]);
    assert.equal(isProcessAlive(pid), true);

    // The caller's escalation block (launch-game.ts): SIGKILL only the
    // survivors — plus the group, so the orphaned grandchild goes too.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore races and missing permissions.
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Ignore races and missing permissions.
    }
    await awaitExit(child);
    assert.equal(isProcessAlive(pid), false);
  });

  it("scenario 3: already-dead pids pass through the escalation harmlessly", async () => {
    if (process.platform === "win32") return;

    const shortLived = spawn("sh", ["-c", "exit 0"], { stdio: "ignore" });
    spawnedChildren.push(shortLived);
    await awaitExit(shortLived);

    // "Already gone or not ours — the poll below re-checks": a dead
    // pid and an empty pid list both settle with no survivors.
    assert.deepEqual(
      await terminateStaleProcesses([shortLived.pid!], 300, {
        pollIntervalMs: 25,
      }),
      []
    );
    assert.deepEqual(
      await terminateStaleProcesses([], 300, { pollIntervalMs: 25 }),
      []
    );
  });

  it("scenario 3: isProcessAlive tells a live pid from a dead one", async () => {
    if (process.platform === "win32") return;

    const live = spawn("sleep", ["30"], { stdio: "ignore" });
    spawnedChildren.push(live);
    await settle();
    assert.equal(isProcessAlive(live.pid!), true);

    const dead = spawn("sh", ["-c", "exit 0"], { stdio: "ignore" });
    spawnedChildren.push(dead);
    await awaitExit(dead);
    assert.equal(isProcessAlive(dead.pid!), false);
  });

  it("scenario 3: the grace-period poll exits early on death and reports stragglers at the deadline", async () => {
    const pids = [42, 43];

    // Straggler at the deadline: the probe never reports death, so the
    // full grace window elapses and the pids are handed to SIGKILL.
    assert.deepEqual(
      await waitForProcessesToExit(pids, 150, {
        probe: () => true,
        pollIntervalMs: 50,
      }),
      pids
    );

    // Dead on the first probe: nothing to wait for.
    assert.deepEqual(
      await waitForProcessesToExit(pids, 150, {
        probe: () => false,
        pollIntervalMs: 50,
      }),
      []
    );

    // Early exit: the probe reports death mid-grace and the poll stops
    // without burning the rest of the window.
    let polls = 0;
    assert.deepEqual(
      await waitForProcessesToExit([7], 2_000, {
        probe: () => ++polls <= 2,
        pollIntervalMs: 20,
      }),
      []
    );
    assert.equal(polls, 3);
  });

  it("scenario 4: cancelAll takes down every registered extraction child (real processes)", async () => {
    if (process.platform === "win32") return;

    const registry = new ChildProcessRegistry();
    const children = [
      spawnDetachedSleep(30),
      spawnDetachedSleep(30),
      spawnDetachedSleep(30),
    ];
    for (const child of children) {
      registry.add(child);
    }
    assert.equal(registry.size, 3);
    await settle();

    registry.cancelAll();

    // POSIX process-group kill: every detached child is gone and the
    // registry is ready for the next extraction.
    assert.equal(registry.size, 0);
    for (const child of children) {
      await awaitExit(child);
      assert.equal(isProcessAlive(child.pid!), false);
    }

    // The registry is reusable after a cancel.
    const reusable = spawnDetachedSleep(30);
    registry.add(reusable);
    assert.equal(registry.size, 1);
    registry.cancelAll();
    await awaitExit(reusable);
    assert.equal(isProcessAlive(reusable.pid!), false);
  });

  it("scenario 4: a child that exits by itself is removed and the size drops", async () => {
    if (process.platform === "win32") return;

    const registry = new ChildProcessRegistry();
    const keeper = spawnDetachedSleep(30);
    const shortLived = spawn("sh", ["-c", "exit 0"], {
      detached: true,
      stdio: "ignore",
    });
    spawnedChildren.push(shortLived);

    // The 7zip wiring: add on spawn, remove on the end/error events.
    registry.add(keeper);
    registry.add(shortLived);
    assert.equal(registry.size, 2);

    await awaitExit(shortLived);
    registry.remove(shortLived);
    assert.equal(registry.size, 1);

    registry.remove(keeper);
    assert.equal(registry.size, 0);
    keeper.kill("SIGKILL");
    await awaitExit(keeper);
  });

  it("scenario 4: cancelAll on an empty registry is a no-op", () => {
    const registry = new ChildProcessRegistry();
    registry.cancelAll();
    assert.equal(registry.size, 0);
  });

  it("scenario 5: a download removed during extraction never comes back as a ghost", async () => {
    const { shouldSkipRegistryRewrite, shouldAbortProgressRewrite } =
      await import("../main/services/download/download-registry-guards.js");

    // The download was cancelled/removed while the extraction was
    // running: the state reset (resetExtractingState), the completion
    // (setExtractionComplete) and the folderName rewrite (the
    // mid-extraction guard) must ALL stay away — rewriting the
    // registry would resurrect the entry in the list.
    const removed = buildDownload({ status: "removed" });
    assert.equal(shouldSkipRegistryRewrite(removed), true);
    assert.equal(shouldAbortProgressRewrite(removed), true);

    // A purged registry entry (LevelDB get → undefined) is the same
    // ghost: abort silently instead of resurrecting stale data.
    assert.equal(shouldSkipRegistryRewrite(undefined), true);
    assert.equal(shouldAbortProgressRewrite(undefined), true);

    // A live download rewrites normally on every path.
    const live = buildDownload({ status: "active", progress: 0.5 });
    assert.equal(shouldSkipRegistryRewrite(live), false);
    assert.equal(shouldAbortProgressRewrite(live), false);
  });

  it("scenario 5: a failed extraction resets a live download to its honest status", async () => {
    const { resolveResetStatus } = await import(
      "../main/services/download/download-registry-guards.js"
    );

    // Finished torrent the user wants to keep seeding → seeding.
    assert.equal(
      resolveResetStatus(
        buildDownload({
          progress: 1,
          shouldSeed: true,
          downloader: Downloader.Torrent,
          status: "extracting",
        })
      ),
      "seeding"
    );

    // Finished but seeding is off — or it never was a torrent — the
    // download is simply complete.
    assert.equal(
      resolveResetStatus(
        buildDownload({
          progress: 1,
          shouldSeed: false,
          downloader: Downloader.Torrent,
          status: "extracting",
        })
      ),
      "complete"
    );
    assert.equal(
      resolveResetStatus(
        buildDownload({
          progress: 1,
          shouldSeed: true,
          downloader: Downloader.Gofile,
          status: "extracting",
        })
      ),
      "complete"
    );

    // An unfinished download keeps the status it already had.
    assert.equal(
      resolveResetStatus(buildDownload({ progress: 0.5, status: "active" })),
      "active"
    );
    assert.equal(
      resolveResetStatus(buildDownload({ progress: 0.99, status: "paused" })),
      "paused"
    );
  });

  it("scenario 6: the kill command takes the whole tree on Windows and a plain -9 elsewhere", () => {
    assert.equal(buildKillCommand(4242, "win32"), "taskkill /PID 4242 /T /F");
    assert.equal(buildKillCommand(4242, "linux"), "kill -9 4242");
    assert.equal(buildKillCommand(4242, "darwin"), "kill -9 4242");

    // The default is the current platform (the elevated fallback in
    // close-game.ts runs with no explicit platform).
    assert.equal(
      buildKillCommand(4242),
      process.platform === "win32" ? "taskkill /PID 4242 /T /F" : "kill -9 4242"
    );
  });
});
