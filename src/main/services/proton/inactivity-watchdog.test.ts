import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createInactivityWatchdog } from "./inactivity-watchdog.ts";

describe("createInactivityWatchdog", () => {
  it("fires the timeout when no progress resets arrive", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let timedOut = false;
    const watchdog = createInactivityWatchdog({
      timeoutMs: 90_000,
      onTimeout: () => {
        timedOut = true;
      },
    });

    t.mock.timers.tick(89_999);
    assert.equal(timedOut, false);

    t.mock.timers.tick(1);
    assert.equal(timedOut, true);
    watchdog.clear();
  });

  it("rearms the timer on every reset and stops on clear", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let timedOut = false;
    const watchdog = createInactivityWatchdog({
      timeoutMs: 90_000,
      onTimeout: () => {
        timedOut = true;
      },
    });

    t.mock.timers.tick(80_000);
    watchdog.reset();

    t.mock.timers.tick(89_999);
    assert.equal(timedOut, false);
    watchdog.reset();

    t.mock.timers.tick(50_000);
    watchdog.clear();

    t.mock.timers.tick(500_000);
    assert.equal(timedOut, false);
  });
});
