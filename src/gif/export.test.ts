import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeTraceAnnotations } from "../sdk.js";
import { exportTerminalGif } from "./export.js";
import type { TuiTrace } from "../trace/types.js";

test("exports terminal frames as an animated gif", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-gif-"));

  try {
    const tracePath = path.join(dir, "trace.json");
    const outputPath = path.join(dir, "trace.gif");
    await writeFile(tracePath, JSON.stringify(sampleTrace()));
    await writeTraceAnnotations(tracePath, [
      {
        frameIndex: 2,
        label: "Ready assertion",
        kind: "assertion",
        assertions: [{ label: "status is ready", passed: true }]
      }
    ]);

    const result = await exportTerminalGif({
      input: tracePath,
      output: outputPath,
      fontSize: 10,
      cellWidth: 6,
      lineHeight: 13,
      padding: 4,
      lastDelayMs: 120,
      workers: 2,
      overlay: {
        position: "top-left"
      }
    });

    const bytes = await readFile(outputPath);
    assert.equal(bytes.subarray(0, 6).toString("ascii"), "GIF89a");
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.frameCount, 3);
    assert.equal(result.encodedFrameCount, 3);
    assert.equal(result.workers, 2);
    assert.equal(readUnsigned16(bytes, 6), result.width);
    assert.equal(readUnsigned16(bytes, 8), result.height);
    assert.ok(bytes.length > 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compacts duplicate terminal states without workers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-gif-compact-"));

  try {
    const tracePath = path.join(dir, "trace.json");
    const outputPath = path.join(dir, "trace.gif");
    await writeFile(
      tracePath,
      JSON.stringify({
        tracePoints: [
          { rows: 2, cols: 16 },
          { data: "same", time: 1000 },
          { data: "\x1b[0m", time: 1050 },
          { data: "\x1b[0m", time: 1100 }
        ],
        testName: ["gif compaction"]
      } satisfies TuiTrace)
    );

    const result = await exportTerminalGif({
      input: tracePath,
      output: outputPath,
      fontSize: 10,
      cellWidth: 6,
      lineHeight: 13,
      padding: 4,
      workers: 1,
      overlay: false
    });

    const bytes = await readFile(outputPath);
    assert.equal(bytes.subarray(0, 6).toString("ascii"), "GIF89a");
    assert.equal(result.workers, 1);
    assert.ok(result.encodedFrameCount < result.frameCount);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function sampleTrace(): TuiTrace {
  return {
    tracePoints: [
      { data: "", time: 1000 },
      { rows: 3, cols: 16 },
      { data: "TUI Replay", time: 1010 },
      { data: "\r\n\x1b[32mready\x1b[0m", time: 1100 }
    ],
    testName: ["gif export"]
  };
}

function readUnsigned16(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
