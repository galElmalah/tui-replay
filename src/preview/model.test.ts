import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeTraceAnnotations } from "../sdk.js";
import type { TuiTrace } from "../trace/types.js";
import { buildPreviewModel } from "./model.js";

test("loads sidecar annotations into preview traces", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-model-"));
  const tracePath = path.join(dir, "trace");

  try {
    await writeFile(tracePath, JSON.stringify(sampleTrace(["start", "oauth done"])));
    await writeTraceAnnotations(tracePath, [
      {
        timeMs: 20,
        label: "User completed OAuth",
        kind: "oauth",
        description: "The callback reached the CLI"
      }
    ]);

    const model = await buildPreviewModel([tracePath], dir);
    const annotation = model.traces[0].annotations[0];

    assert.equal(annotation.label, "User completed OAuth");
    assert.equal(annotation.kind, "oauth");
    assert.equal(annotation.timeMs, 20);
    assert.equal(annotation.frameIndex, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function sampleTrace(lines: string[]): TuiTrace {
  return {
    tracePoints: [
      { data: "", time: 1000 },
      { rows: 5, cols: 30 },
      ...lines.map((line, index) => ({
        data: `${index === 0 ? "" : "\r\n"}${line}`,
        time: 1010 + index * 10
      }))
    ],
    testName: ["annotated trace"],
    attempt: 0
  };
}
