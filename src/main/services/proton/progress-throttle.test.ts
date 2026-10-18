import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProtonInstallProgress } from "@types";

import { createProgressThrottle } from "./progress-throttle.ts";

const payload = (
  phase: ProtonInstallProgress["phase"],
  receivedBytes?: number
): ProtonInstallProgress => ({
  providerId: "ge-proton",
  tag: "GE-Proton9-20",
  phase,
  receivedBytes,
});

describe("createProgressThrottle", () => {
  it("emits phase changes immediately regardless of the interval", () => {
    const clock = 0;
    const emitted: ProtonInstallProgress[] = [];
    const throttled = createProgressThrottle({
      emit: (value) => emitted.push(value),
      minIntervalMs: 200,
      now: () => clock,
    });

    throttled(payload("downloading", 1));
    throttled(payload("verifying"));
    throttled(payload("extracting"));
    throttled(payload("promoting"));
    throttled(payload("done"));

    assert.equal(emitted.length, 5);
  });

  it("limits byte updates within the same phase to one per interval", () => {
    let clock = 0;
    const emitted: number[] = [];
    const throttled = createProgressThrottle({
      emit: (value) => emitted.push(value.receivedBytes ?? 0),
      minIntervalMs: 200,
      now: () => clock,
    });

    throttled(payload("downloading", 10));
    clock = 50;
    throttled(payload("downloading", 20));
    clock = 150;
    throttled(payload("downloading", 30));
    clock = 200;
    throttled(payload("downloading", 40));
    clock = 300;
    throttled(payload("downloading", 50));
    clock = 450;
    throttled(payload("downloading", 60));

    assert.deepEqual(emitted, [10, 40, 60]);
  });

  it("always emits terminal phases", () => {
    let clock = 0;
    const emitted: ProtonInstallProgress["phase"][] = [];
    const throttled = createProgressThrottle({
      emit: (value) => emitted.push(value.phase),
      minIntervalMs: 60_000,
      now: () => clock,
    });

    throttled(payload("downloading", 1));
    clock = 1;
    throttled(payload("done"));

    assert.deepEqual(emitted, ["downloading", "done"]);
  });

  it("resumes normal emission after an interval passes", () => {
    let clock = 1_000;
    const emitted: number[] = [];
    const throttled = createProgressThrottle({
      emit: (value) => emitted.push(value.receivedBytes ?? 0),
      minIntervalMs: 200,
      now: () => clock,
    });

    throttled(payload("downloading", 1));
    clock += 50;
    throttled(payload("downloading", 2));
    clock += 200;
    throttled(payload("downloading", 3));

    assert.deepEqual(emitted, [1, 3]);
  });
});
