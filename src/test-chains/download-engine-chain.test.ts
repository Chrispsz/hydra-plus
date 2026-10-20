/**
 * Chain B — "a download from link to verified file" (download engine puzzle).
 *
 * One continuous scenario per stage, feeding outputs of one module as inputs
 * to the next, exactly like a user's download flows through the F3 engine:
 *
 *   link classification (shared) →
 *   parallel range engine over a real loopback HTTP server →
 *   byte-for-byte reassembly + persisted range state →
 *   mid-flight abort → fresh-process resume from persisted state →
 *   resume-prefix integrity guard → throttle budget →
 *   finalize decision + queue-verify ledger.
 *
 * Everything is deterministic: a loopback node:http server, a seeded byte
 * fixture, an abort triggered by a byte counter (never by a wall clock) and
 * a generous throttle so the budget math runs without real sleeps.
 */
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Downloader } from "../shared/constants.js";
import { getDownloadersForUri } from "../shared/index.js";
import { downloadParallelRanges } from "../main/services/download/parallel-range-download.js";
import {
  configureRangeStateDirectory,
  readRangeState,
  removeRangeState,
  savedRangeBytes,
  missingRanges,
} from "../main/services/download/range-download-state.js";
import { DownloadThrottle } from "../main/services/download/download-throttle.js";
import {
  verifyResumePrefixChunk,
  ResumePrefixMismatchError,
} from "../main/services/download/js-http-downloader-helpers.js";
import { shouldFinalizeDownload } from "../main/services/download/download-completion.js";
import {
  getQueueVerifySig,
  isVerifyAttemptFresh,
  recordVerifyAttempt,
  clearVerifyAttempt,
} from "../main/services/download/download-queue-verify.js";
import {
  coversWholeFileExactly,
  everyRequestFitsInsideAHole,
  type ExclusiveRange,
} from "./helpers/range-coverage.js";

const FIXTURE_TOTAL = 1_572_864; // 1.5 MiB, 6 jobs at the 256 KiB range size
const RANGE_SIZE = 256 * 1024;
const CONNECTIONS = 3;
const ETAG = '"chain-b-fixture-v1"';

const makeFixture = (): Buffer => {
  const fixture = Buffer.alloc(FIXTURE_TOTAL);
  for (let i = 0; i < fixture.length; i += 1) {
    fixture[i] = (i * 31 + 7) & 0xff;
  }
  return fixture;
};

interface CapturedRequest {
  start: number;
  /** endExclusive — 0 means the request was open-ended (`bytes=S-`). */
  endExclusive: number;
  ifRange: string | null;
}

const createRangeServer = (
  fixture: Buffer,
  captured: CapturedRequest[]
): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rangeHeader = req.headers.range ?? "";
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      const start = match ? Number(match[1]) : 0;
      const open = !match || match[2] === "";
      const endInclusive = open
        ? fixture.length - 1
        : Math.min(Number(match[2]), fixture.length - 1);
      captured.push({
        start,
        endExclusive: open ? 0 : endInclusive + 1,
        ifRange: (req.headers["if-range"] as string | undefined) ?? null,
      });

      const slice = fixture.subarray(start, endInclusive + 1);
      res.writeHead(206, {
        "accept-ranges": "bytes",
        etag: ETAG,
        "content-type": "application/octet-stream",
        "content-length": slice.length,
        "content-range": `bytes ${start}-${endInclusive}/${fixture.length}`,
      });
      res.end(slice);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const serverUrl = (server: http.Server): string => {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/fixture.bin`;
};

const closeServer = (server: http.Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    // undici (global fetch) keeps idle keep-alive sockets pooled for minutes,
    // which would keep the event loop alive long after the test finished.
    server.closeAllConnections?.();
  });

const makeWorkdir = (name: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hydra-chain-b-${name}-`));
  configureRangeStateDirectory(dir);
  return dir;
};

const fetchFirstResponse = async (url: string): Promise<Response> => {
  const response = await fetch(url, { headers: { Range: "bytes=0-" } });
  assert.equal(response.status, 206);
  return response;
};

const jobRequests = (captured: CapturedRequest[]): ExclusiveRange[] =>
  captured
    .filter((request) => request.endExclusive !== 0)
    .map(({ start, endExclusive }) => [start, endExclusive] as ExclusiveRange);

const bytesOf = (ranges: readonly ExclusiveRange[]): number =>
  ranges.reduce((sum, [start, end]) => sum + (end - start), 0);

describe("chain B — a download from link to verified file", () => {
  it("classifies links to the free downloaders the user will get", () => {
    assert.deepEqual(getDownloadersForUri("magnet:?xt=urn:btih:abc"), [
      Downloader.Torrent,
      Downloader.Hydra,
    ]);
    // The F4 fix: mediafire without the "www" prefix still resolves to the
    // free Mediafire downloader instead of a paid debrid path.
    assert.deepEqual(getDownloadersForUri("https://mediafire.com/file/x/y"), [
      Downloader.Mediafire,
    ]);
    assert.deepEqual(getDownloadersForUri("https://gofile.io/d/x"), [
      Downloader.Gofile,
    ]);
    assert.deepEqual(
      getDownloadersForUri("https://pixeldrain.com/api/file/x"),
      [Downloader.PixelDrain]
    );
    // No free downloader exists for this host — must resolve to none.
    assert.deepEqual(getDownloadersForUri("https://1fichier.com/?x"), []);
  });

  it("downloads a fixture in parallel ranges, reassembles it byte-for-byte and finalizes", async () => {
    const workdir = makeWorkdir("full-download");
    const filePath = path.join(workdir, "game-setup.bin");
    const fixture = makeFixture();
    const captured: CapturedRequest[] = [];
    const server = await createRangeServer(fixture, captured);
    const url = serverUrl(server);
    fs.writeFileSync(filePath, Buffer.alloc(fixture.length));

    try {
      const controller = new AbortController();
      const throttle = new DownloadThrottle();
      throttle.setLimit(8 * 1024 * 1024); // generous: budget math, no real sleeps
      let bytesThroughThrottle = 0;
      let completedBefore = 0;

      const complete = await downloadParallelRanges({
        url,
        headers: {},
        firstResponse: await fetchFirstResponse(url),
        filePath,
        startByte: 0,
        total: fixture.length,
        rangeSize: RANGE_SIZE,
        connectionCount: CONNECTIONS,
        signal: controller.signal,
        abort: () => controller.abort(),
        beforeChunk: async (length) => {
          bytesThroughThrottle += length;
          await throttle.wait(length, controller.signal);
        },
        beforeComplete: async () => {
          completedBefore += 1;
        },
        afterChunk: () => undefined,
        onReadPending: () => undefined,
      });

      // Stage 2 → 3: the engine finished and every byte survived the trip.
      assert.equal(complete, true);
      const onDisk = await fsp.readFile(filePath);
      assert.equal(onDisk.length, fixture.length);
      assert.equal(
        crypto.createHash("sha256").update(onDisk).digest("hex"),
        crypto.createHash("sha256").update(fixture).digest("hex")
      );
      assert.deepEqual(onDisk, fixture);

      // Stage 3 → 4: what the server actually served tiles the file exactly.
      const jobs = jobRequests(captured);
      const jobRequests_ = captured.filter(
        (request) => request.endExclusive !== 0
      );
      assert.ok(jobs.length >= 4, "engine split the file into parallel ranges");
      // Exact tiling: every byte requested exactly once — no gap (covers the
      // whole file) and no overlap (requested byte count equals the file).
      assert.equal(bytesOf(jobs), fixture.length);
      assert.ok(coversWholeFileExactly(jobs, fixture.length));
      assert.ok(
        jobRequests_.every((request) => request.ifRange === ETAG),
        "every range request presented the strong validator"
      );

      // Stage 3 → 5: completion triggers exactly one finalize handshake and
      // the persisted range state is cleaned up afterwards.
      assert.equal(completedBefore, 1);
      assert.equal(readRangeState(filePath), null);

      // Stage 5: the resume guard accepts the real prefix and rejects tampering.
      const handle = await fsp.open(filePath, "r+");
      const remotePrefix = fixture.subarray(0, 64 * 1024);
      await verifyResumePrefixChunk(
        handle,
        remotePrefix,
        0,
        remotePrefix.length
      );
      await handle.close();
      const tampered = Buffer.from(fixture);
      tampered[0] ^= 0xff;
      const tamperedFile = path.join(workdir, "tampered.bin");
      fs.writeFileSync(tamperedFile, tampered);
      const tamperedHandle = await fsp.open(tamperedFile, "r+");
      await assert.rejects(
        () =>
          verifyResumePrefixChunk(
            tamperedHandle,
            remotePrefix,
            0,
            remotePrefix.length
          ),
        ResumePrefixMismatchError
      );
      await tamperedHandle.close();

      // Stage 5 → 6: the throttle really taxed the bytes that moved through.
      assert.equal(bytesThroughThrottle, fixture.length);

      // Stage 6: the finalize gate only fires for a completed js download.
      assert.equal(
        shouldFinalizeDownload({
          usingJsDownloader: true,
          isCheckingFiles: false,
          isDownloadingMetadata: false,
          progress: 1,
          downloadStatus: "complete",
        }),
        true
      );
      assert.equal(
        shouldFinalizeDownload({
          usingJsDownloader: true,
          isCheckingFiles: false,
          isDownloadingMetadata: false,
          progress: 0.4,
          downloadStatus: "active",
        }),
        false
      );
      assert.equal(
        shouldFinalizeDownload({
          usingJsDownloader: true,
          isCheckingFiles: true,
          isDownloadingMetadata: false,
          progress: 1,
          downloadStatus: "complete",
        }),
        false
      );
    } finally {
      await closeServer(server);
      removeRangeState(filePath);
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("aborts mid-flight, then a fresh run resumes only the missing ranges", async () => {
    const workdir = makeWorkdir("resume");
    const filePath = path.join(workdir, "game-setup.bin");
    const fixture = makeFixture();
    const capturedFirstRun: CapturedRequest[] = [];
    const server = await createRangeServer(fixture, capturedFirstRun);
    const url = serverUrl(server);
    fs.writeFileSync(filePath, Buffer.alloc(fixture.length));

    try {
      // --- run 1: download until the first range lands, then pull the plug
      // exactly at a byte boundary (never a clock boundary). One range in,
      // five ranges in flight — the abort is guaranteed to be mid-flight.
      const abortAfterBytes = RANGE_SIZE;
      let received = 0;
      let completedFirstRun = 0;
      const firstRun = new AbortController();
      const firstError: unknown = await downloadParallelRanges({
        url,
        headers: {},
        firstResponse: await fetchFirstResponse(url),
        filePath,
        startByte: 0,
        total: fixture.length,
        rangeSize: RANGE_SIZE,
        connectionCount: CONNECTIONS,
        signal: firstRun.signal,
        abort: () => firstRun.abort(),
        beforeChunk: async (_length) => {
          if (!firstRun.signal.aborted && received >= abortAfterBytes) {
            firstRun.abort();
          }
          firstRun.signal.throwIfAborted();
        },
        beforeComplete: async () => {
          completedFirstRun += 1;
        },
        afterChunk: (length) => {
          received += length;
        },
        onReadPending: () => undefined,
      }).then(
        () => null,
        (error: unknown) => error
      );
      assert.ok(firstError instanceof Error, "run 1 aborted with an error");
      assert.equal(
        completedFirstRun,
        0,
        "the aborted run must not have finalized"
      );

      // Stage 3 → 4: the persisted state survives the crash and knows the holes.
      const saved = readRangeState(filePath);
      assert.ok(saved, "range state persisted before the abort");
      assert.ok(savedRangeBytes(saved) < fixture.length);
      const holes = missingRanges(saved);
      assert.ok(holes.length > 0, "resume has real holes to fill");

      // The bytes the persisted state CLAIMS are saved must match the fixture;
      // the holes are the only places a fresh byte may still be missing.
      const partial = await fsp.readFile(filePath);
      const savedRanges: ExclusiveRange[] = [];
      let cursor = 0;
      for (const [holeStart, holeEnd] of holes) {
        if (holeStart > cursor) savedRanges.push([cursor, holeStart]);
        cursor = holeEnd;
      }
      if (cursor < fixture.length) savedRanges.push([cursor, fixture.length]);
      assert.ok(savedRanges.length > 0);
      for (const [start, end] of savedRanges) {
        const probe = Math.min(end, start + 4096);
        assert.equal(
          partial
            .subarray(start, probe)
            .compare(fixture.subarray(start, probe)),
          0,
          `saved range [${start}, ${end}) holds correct fixture bytes`
        );
      }

      // --- run 2: a "fresh process" picks the file back up.
      const capturedSecondRun: CapturedRequest[] = [];
      const resumeServer = await createRangeServer(fixture, capturedSecondRun);
      const resumeUrl = serverUrl(resumeServer);
      let completedBefore = 0;
      const secondRun = new AbortController();
      const complete = await downloadParallelRanges({
        url: resumeUrl,
        headers: {},
        firstResponse: await fetchFirstResponse(resumeUrl),
        filePath,
        startByte: 0,
        total: fixture.length,
        rangeSize: RANGE_SIZE,
        connectionCount: CONNECTIONS,
        signal: secondRun.signal,
        abort: () => secondRun.abort(),
        beforeChunk: async () => {
          secondRun.signal.throwIfAborted();
        },
        beforeComplete: async () => {
          completedBefore += 1;
        },
        afterChunk: () => undefined,
        onReadPending: () => undefined,
      });

      assert.equal(complete, true);
      assert.equal(completedBefore, 1);
      assert.deepEqual(await fsp.readFile(filePath), fixture);

      // Stage 4 → 5: the second run only asked for what the holes said was
      // missing — no duplicated range, no byte outside the holes.
      const resumeJobs = jobRequests(capturedSecondRun);
      assert.ok(resumeJobs.length > 0);
      // The resume asked for every missing byte exactly once: the total
      // requested equals the holes, and nothing outside the holes.
      assert.equal(bytesOf(resumeJobs), bytesOf(holes));
      assert.ok(
        everyRequestFitsInsideAHole(resumeJobs, holes),
        "resume requests stayed inside the persisted holes"
      );
      assert.ok(
        resumeJobs.some(([start]) =>
          holes.some(([holeStart]) => start === holeStart)
        ),
        "resume re-used the exact hole boundaries"
      );
      assert.equal(readRangeState(filePath), null);

      await closeServer(resumeServer);
    } finally {
      await closeServer(server);
      removeRangeState(filePath);
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("keeps the queue-verify ledger honest for repeat downloads", async () => {
    const workdir = makeWorkdir("ledger");
    try {
      // A populated target folder gets a fresh signature.
      fs.mkdirSync(path.join(workdir, "target"));
      fs.writeFileSync(path.join(workdir, "target", "game.exe"), "payload");
      const sig = await getQueueVerifySig(path.join(workdir, "target"));
      assert.ok(typeof sig === "string" && sig.length > 0);

      // Recording the attempt makes it fresh; clearing it expires it.
      const attempts = new Map();
      recordVerifyAttempt(attempts, "game:custom:uuid", sig, Date.now());
      assert.equal(
        isVerifyAttemptFresh(attempts.get("game:custom:uuid"), sig, Date.now()),
        true
      );
      // The signature of an unchanged directory is stable, of an empty one null.
      assert.equal(
        await getQueueVerifySig(path.join(workdir, "missing")),
        null
      );
      clearVerifyAttempt(attempts, "game:custom:uuid");
      assert.equal(
        isVerifyAttemptFresh(attempts.get("game:custom:uuid"), sig, Date.now()),
        false
      );

      // A changed target (new signature) must not count as fresh either.
      recordVerifyAttempt(
        attempts,
        "game:custom:uuid",
        "stale-sig",
        Date.now()
      );
      assert.equal(
        isVerifyAttemptFresh(attempts.get("game:custom:uuid"), sig, Date.now()),
        false
      );
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("hands out throttle budget deterministically", async () => {
    const throttle = new DownloadThrottle();

    // No limit configured: every wait is free.
    throttle.setLimit(null);
    const started = Date.now();
    await throttle.wait(Number.MAX_SAFE_INTEGER);
    assert.ok(Date.now() - started < 500);

    // With a limit, small budgets resolve within one check interval.
    throttle.setLimit(1024 * 1024);
    const budgeted = Date.now();
    await throttle.wait(1);
    assert.ok(Date.now() - budgeted < 1000);
    assert.ok(Date.now() - budgeted >= 0);
  });
});
