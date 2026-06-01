import assert from "node:assert/strict";
import test from "node:test";
import type { TraceReplay } from "../trace/types.js";
import { timelineItems } from "./selectors.js";

test("timeline items include standalone annotations between frames", () => {
  const trace = sampleTrace();
  const items = timelineItems(trace, 0);

  assert.deepEqual(
    items.map((item) => `${item.type}:${item.type === "frame" ? item.frame.index : item.annotation.label}`),
    ["frame:0", "frame:1", "annotation:OAuth approved", "annotation:Policy allowed", "frame:2"]
  );
});

function sampleTrace(): TraceReplay {
  return {
    summary: {
      id: "trace-0",
      filePath: "/tmp/trace",
      fileName: "trace",
      testTitle: "timeline test",
      durationMs: 200,
      frameCount: 3,
      rows: 2,
      cols: 10
    },
    frames: [
      { index: 0, eventIndex: 0, time: 0, rows: 2, cols: 10, lines: [], plainText: "" },
      { index: 1, eventIndex: 1, time: 100, rows: 2, cols: 10, lines: [], plainText: "" },
      { index: 2, eventIndex: 2, time: 200, rows: 2, cols: 10, lines: [], plainText: "" }
    ],
    annotations: [
      {
        id: "oauth",
        label: "OAuth approved",
        timeMs: 100,
        frameIndex: 1,
        assertions: [],
        attachments: []
      },
      {
        id: "policy",
        label: "Policy allowed",
        timeMs: 150,
        frameIndex: 1,
        assertions: [],
        attachments: []
      }
    ],
    details: {
      snapshotNames: [],
      expectations: []
    }
  };
}
