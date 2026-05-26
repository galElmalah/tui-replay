import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FFMPEG_NOT_FOUND_CODE, exportTerminalVideo, resolveFfmpegPath } from "./export.js";
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

test("reports actionable guidance when ffmpeg is not on PATH", async () => {
  await assert.rejects(
    () => resolveFfmpegPath(undefined, { PATH: "" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, FFMPEG_NOT_FOUND_CODE);
      assert.match(error.message, /Unable to find ffmpeg/);
      assert.match(error.message, /--ffmpeg-path/);
      assert.match(error.message, /TUI_REPLAY_FFMPEG/);
      assert.match(error.message, /brew install ffmpeg/);
      assert.match(error.message, /Agent hint/);
      return true;
    }
  );
});

test("reports the configured ffmpeg path that failed", async () => {
  const missingPath = path.join(os.tmpdir(), "tui-replay-missing-ffmpeg");

  await assert.rejects(
    () => resolveFfmpegPath(missingPath, { PATH: "" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, FFMPEG_NOT_FOUND_CODE);
      assert.match(error.message, /configured ffmpeg binary/);
      assert.match(error.message, /--ffmpeg-path/);
      assert.match(error.message, new RegExp(escapeRegExp(missingPath)));
      assert.match(error.message, /Agent hint/);
      return true;
    }
  );
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
