import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportTerminalVideo, resolveFfmpegPath } from "./export.js";
import type { TuiTrace } from "../trace/types.js";

const ffmpegAvailable = await hasFfmpeg();

test("exports terminal frames as an mp4 video", { skip: !ffmpegAvailable }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-video-"));

  try {
    const tracePath = path.join(dir, "trace.json");
    const outputPath = path.join(dir, "trace.mp4");
    await writeFile(tracePath, JSON.stringify(sampleTrace()));

    const result = await exportTerminalVideo({
      input: tracePath,
      output: outputPath,
      fontSize: 10,
      cellWidth: 6,
      lineHeight: 13,
      padding: 4,
      lastDelayMs: 120,
      overlay: true
    });

    const bytes = await readFile(outputPath);
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.format, "mp4");
    assert.equal(result.frameCount, 3);
    assert.equal(result.width % 2, 0);
    assert.equal(result.height % 2, 0);
    assert.ok(bytes.includes(Buffer.from("ftyp")));
    assert.ok(bytes.length > 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function hasFfmpeg(): Promise<boolean> {
  try {
    await resolveFfmpegPath();
    return true;
  } catch {
    return false;
  }
}

function sampleTrace(): TuiTrace {
  return {
    tracePoints: [
      { data: "", time: 1000 },
      { rows: 3, cols: 16 },
      { data: "TUI Replay", time: 1010 },
      { data: "\r\n\x1b[32mready\x1b[0m", time: 1100 }
    ],
    testName: ["video export"]
  };
}
