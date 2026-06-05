import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeTraceAnnotations } from "../sdk.js";
import type { TuiTrace } from "../trace/types.js";
import { loadTerminalRenderSource, renderTerminalFrameSvg } from "./terminal-render.js";

test("renders annotations into media overlays", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-media-"));

  try {
    const tracePath = path.join(dir, "trace.json");
    await writeFile(tracePath, JSON.stringify(sampleTrace()));
    await writeTraceAnnotations(tracePath, [
      {
        frameIndex: 2,
        label: "OAuth completed",
        kind: "oauth",
        assertions: [{ label: "callback matched", passed: true }]
      }
    ]);

    const source = await loadTerminalRenderSource({
      input: tracePath,
      fontSize: 10,
      cellWidth: 6,
      lineHeight: 13,
      padding: 4,
      overlay: true
    });
    const frame = source.frames[2];
    const svg = renderTerminalFrameSvg(
      frame,
      source.metrics,
      source.annotations.filter((annotation) => annotation.frameIndex === frame.index)
    );

    assert.match(svg, /Frame 3 \/ 3/);
    assert.match(svg, /oauth: OAuth/);
    assert.match(svg, /completed \(1 assert\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps long annotation overlays inside the frame", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-media-"));

  try {
    const tracePath = path.join(dir, "trace.json");
    const longLabel = "OAuth authorization opened and completed with a long provider callback label";
    await writeFile(tracePath, JSON.stringify(sampleTrace()));
    await writeTraceAnnotations(tracePath, [
      {
        frameIndex: 2,
        label: longLabel,
        kind: "oauth",
        assertions: [{ label: "callback matched", passed: true }]
      }
    ]);

    const source = await loadTerminalRenderSource({
      input: tracePath,
      fontSize: 10,
      cellWidth: 6,
      lineHeight: 13,
      padding: 4,
      overlay: { position: "bottom-right" }
    });
    const frame = source.frames[2];
    const svg = renderTerminalFrameSvg(
      frame,
      source.metrics,
      source.annotations.filter((annotation) => annotation.frameIndex === frame.index)
    );
    const overlayRect = overlayRectElement(svg);
    const x = numberAttribute(overlayRect, "x");
    const y = numberAttribute(overlayRect, "y");
    const width = numberAttribute(overlayRect, "width");
    const height = numberAttribute(overlayRect, "height");
    const overlayText = overlayTextLines(svg);

    assert.ok(x >= 0);
    assert.ok(y >= 0);
    assert.ok(x + width <= source.metrics.width);
    assert.ok(y + height <= source.metrics.height);
    assert.ok(overlayText.some((line) => line.includes("oauth: OAuth")));
    assert.ok(!overlayText.includes(`oauth: ${longLabel} (1 assert)`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function sampleTrace(): TuiTrace {
  return {
    tracePoints: [
      { data: "", time: 1000 },
      { rows: 3, cols: 18 },
      { data: "TUI Replay", time: 1010 },
      { data: "\r\n\x1b[32mready\x1b[0m", time: 1100 }
    ],
    testName: ["media export"]
  };
}

function overlayRectElement(svg: string): string {
  const match = /<rect [^>]*opacity="0\.9"[^>]*>/.exec(svg);
  assert.ok(match);
  return match[0];
}

function overlayTextLines(svg: string): string[] {
  return [...svg.matchAll(/<text [^>]*font-weight="(?:700|600)"[^>]*>(.*?)<\/text>/g)].map((match) => match[1]);
}

function numberAttribute(element: string, name: string): number {
  const match = new RegExp(`${name}="([^"]+)"`).exec(element);
  assert.ok(match);
  return Number(match[1]);
}
