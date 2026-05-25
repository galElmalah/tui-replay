import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendTraceAnnotation, annotationPathForTrace, readTraceAnnotations, writeTraceAnnotations } from "./sdk.js";

test("writes and appends trace annotation sidecars", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-sdk-"));
  const tracePath = path.join(dir, "trace");

  try {
    const annotationPath = await writeTraceAnnotations(tracePath, [
      {
        timeMs: 1200,
        label: "User started OAuth",
        kind: "oauth",
        description: "Browser redirected to provider"
      }
    ]);
    assert.equal(annotationPath, annotationPathForTrace(tracePath));

    await appendTraceAnnotation(tracePath, {
      frameIndex: 4,
      label: "OAuth callback returned",
      kind: "oauth"
    });

    const file = await readTraceAnnotations(tracePath);
    assert.equal(file.version, 1);
    assert.equal(file.annotations.length, 2);
    assert.equal(file.annotations[0].label, "User started OAuth");
    assert.equal(file.annotations[1].frameIndex, 4);

    const raw = JSON.parse(await readFile(annotationPath, "utf8")) as { annotations: unknown[] };
    assert.equal(raw.annotations.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects annotations without a timeline target", async () => {
  await assert.rejects(
    () =>
      writeTraceAnnotations("/tmp/trace", [
        {
          label: "No target"
        }
      ]),
    /needs timeMs, frameIndex, or eventIndex/
  );
});
