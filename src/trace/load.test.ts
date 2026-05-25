import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import test from "node:test";
import { loadTraceFile, loadTraceInputs } from "./load.js";
import { renderTraceFrames } from "./render.js";
import type { TuiTrace } from "./types.js";

const deflate = promisify(zlib.deflate);

test("loads compressed tui-test traces", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));
  const tracePath = path.join(dir, "trace");

  try {
    const trace = sampleTrace();
    await writeFile(tracePath, await deflate(Buffer.from(JSON.stringify(trace), "utf8")));

    const loaded = await loadTraceFile(tracePath);
    assert.deepEqual(loaded.testName, ["renders text"]);
    assert.equal(loaded.tracePoints.length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discovers traces in directories and skips non-trace files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));

  try {
    await mkdir(path.join(dir, "tui-traces"));
    await writeFile(path.join(dir, "README.md"), "not a trace");
    await writeFile(path.join(dir, "tui-traces", "trace.json"), JSON.stringify(sampleTrace()));

    const traces = await loadTraceInputs([dir]);
    assert.equal(traces.length, 1);
    assert.equal(traces[0].trace.testName?.[0], "renders text");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renders terminal frames with cursor movement", async () => {
  const frames = await renderTraceFrames({
    tracePoints: [
      { data: "", time: 1000 },
      { rows: 4, cols: 12 },
      { data: "hello", time: 1010 },
      { data: "\x1b[1;1HHELLO", time: 1020 }
    ]
  });

  assert.equal(frames.length, 3);
  assert.match(frames.at(-1)?.plainText ?? "", /HELLO/);
  assert.equal(frames.at(-1)?.rows, 4);
  assert.equal(frames.at(-1)?.cols, 12);
});

test("renders truecolor foreground styles", async () => {
  const frames = await renderTraceFrames({
    tracePoints: [
      { data: "", time: 1000 },
      { rows: 2, cols: 10 },
      { data: "\x1b[38;2;0;0;255mblue", time: 1010 }
    ]
  });

  const styledSegment = frames.at(-1)?.lines[0].find((segment) => segment.text.includes("blue"));
  assert.equal(styledSegment?.fg, "#0000ff");
});

function sampleTrace(): TuiTrace {
  return {
    tracePoints: [
      { data: "", time: 1000 },
      { rows: 5, cols: 20 },
      { data: "hello", time: 1010 },
      { data: "\r\nworld", time: 1030 }
    ],
    testPath: ["tests", "demo.tui.test.ts", "3", "1"],
    testName: ["renders text"],
    attempt: 0
  };
}
