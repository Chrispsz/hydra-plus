import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as protonManagerUtils from "./settings-proton-manager-utils.ts";

const {
  getProtonErrorI18nKey,
  getProtonInstallPercent,
  isProtonCancellationCode,
  isRemovableProtonVersion,
  isTerminalProtonInstallPhase,
  toProtonErrorCode,
} = protonManagerUtils;

describe("settings proton manager utils", () => {
  describe("isTerminalProtonInstallPhase", () => {
    it("treats done and error as terminal", () => {
      assert.equal(isTerminalProtonInstallPhase("done"), true);
      assert.equal(isTerminalProtonInstallPhase("error"), true);
    });

    it("treats running phases as active", () => {
      assert.equal(isTerminalProtonInstallPhase("downloading"), false);
      assert.equal(isTerminalProtonInstallPhase("verifying"), false);
      assert.equal(isTerminalProtonInstallPhase("extracting"), false);
      assert.equal(isTerminalProtonInstallPhase("promoting"), false);
    });
  });

  describe("getProtonInstallPercent", () => {
    it("computes the rounded percentage", () => {
      assert.equal(getProtonInstallPercent(0, 400), 0);
      assert.equal(getProtonInstallPercent(200, 400), 50);
      assert.equal(getProtonInstallPercent(1, 3), 33);
    });

    it("clamps out-of-range byte counters", () => {
      assert.equal(getProtonInstallPercent(500, 400), 100);
      assert.equal(getProtonInstallPercent(-10, 400), 0);
    });

    it("is indeterminate without usable byte counters", () => {
      assert.equal(getProtonInstallPercent(undefined, 400), null);
      assert.equal(getProtonInstallPercent(200, undefined), null);
      assert.equal(getProtonInstallPercent(200, 0), null);
      assert.equal(getProtonInstallPercent(200, -1), null);
      assert.equal(getProtonInstallPercent(Number.NaN, 400), null);
      assert.equal(getProtonInstallPercent(200, Number.NaN), null);
    });
  });

  describe("toProtonErrorCode", () => {
    it("extracts the code prefix from error messages", () => {
      assert.equal(
        toProtonErrorCode(new Error("proton_rate_limited")),
        "proton_rate_limited"
      );
      assert.equal(
        toProtonErrorCode(new Error("proton_verification_size_mismatch:12:34")),
        "proton_verification_size_mismatch"
      );
    });

    it("accepts plain result error codes", () => {
      assert.equal(
        toProtonErrorCode("proton_install_busy"),
        "proton_install_busy"
      );
    });

    it("collapses unknown messages to the generic failure code", () => {
      assert.equal(
        toProtonErrorCode(new Error("boom")),
        "proton_install_failed"
      );
      assert.equal(toProtonErrorCode(undefined), "proton_install_failed");
      assert.equal(toProtonErrorCode(""), "proton_install_failed");
    });
  });

  describe("isProtonCancellationCode", () => {
    it("recognizes user-triggered cancellations", () => {
      assert.equal(isProtonCancellationCode("canceled"), true);
      assert.equal(isProtonCancellationCode("proton_download_canceled"), true);
      assert.equal(isProtonCancellationCode("proton_extraction_aborted"), true);
    });

    it("does not swallow real failures", () => {
      assert.equal(isProtonCancellationCode("proton_download_failed"), false);
      assert.equal(isProtonCancellationCode("proton_install_failed"), false);
    });
  });

  describe("isRemovableProtonVersion", () => {
    it("allows compatibility tool builds", () => {
      assert.equal(
        isRemovableProtonVersion({ source: "compatibility_tools" }),
        true
      );
      assert.equal(isRemovableProtonVersion({ source: "unknown" }), true);
      assert.equal(isRemovableProtonVersion({ source: undefined }), true);
    });

    it("refuses Steam-managed builds", () => {
      assert.equal(isRemovableProtonVersion({ source: "steam" }), false);
    });
  });

  describe("getProtonErrorI18nKey", () => {
    it("maps rate limiting to the dedicated message", () => {
      assert.equal(
        getProtonErrorI18nKey("proton_rate_limited"),
        "rate_limited"
      );
    });

    it("maps cancellations to no message at all", () => {
      assert.equal(getProtonErrorI18nKey("canceled"), null);
      assert.equal(getProtonErrorI18nKey("proton_download_canceled"), null);
    });

    it("falls back to the generic failure label", () => {
      assert.equal(
        getProtonErrorI18nKey("proton_extraction_failed"),
        "phase_error"
      );
      assert.equal(getProtonErrorI18nKey("whatever"), "phase_error");
    });
  });
});
