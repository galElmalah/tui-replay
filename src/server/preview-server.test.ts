import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeTraceAnnotations } from "../sdk.js";
import { startPreviewServer } from "./preview-server.js";
import type { PreviewModel, TuiTrace } from "../trace/types.js";

test("reloads trace data for each api request", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));
  const tracePath = path.join(dir, "trace.json");
  const server = await startPreviewServer({
    inputs: [tracePath],
    host: "127.0.0.1",
    port: 0,
    projectRoot: dir,
    openBrowser: false
  });

  try {
    await writeFile(tracePath, JSON.stringify(sampleTrace(["first"])));
    const first = await readModel(server.url);
    assert.equal(first.traces[0].summary.frameCount, 2);

    await writeFile(tracePath, JSON.stringify(sampleTrace(["first", "second", "third"])));
    const second = await readModel(server.url);
    assert.equal(second.traces[0].summary.frameCount, 4);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pushes trace updates over the event stream when files change", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));
  const tracePath = path.join(dir, "trace.json");
  await writeFile(tracePath, JSON.stringify(sampleTrace(["first"])));
  const server = await startPreviewServer({
    inputs: [tracePath],
    host: "127.0.0.1",
    port: 0,
    projectRoot: dir,
    openBrowser: false
  });
  const abort = new AbortController();

  try {
    const response = await fetch(`${server.url}/api/events`, { signal: abort.signal });
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const updated = waitForModelEvent(response.body.getReader(), (model) => model.traces[0]?.summary.frameCount === 4);

    await writeFile(tracePath, JSON.stringify(sampleTrace(["first", "second", "third"])));

    const model = await updated;
    assert.equal(model.traces[0].summary.frameCount, 4);
  } finally {
    abort.abort();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("serves annotation attachments for web previews", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));
  const tracePath = path.join(dir, "trace.json");
  const attachmentPath = path.join(dir, "attachment.txt");
  await writeFile(tracePath, JSON.stringify(sampleTrace(["first"])));
  await writeFile(attachmentPath, "attachment body");
  await writeTraceAnnotations(tracePath, [
    {
      frameIndex: 1,
      label: "Attachment evidence",
      attachments: [{ path: attachmentPath }]
    }
  ]);
  const server = await startPreviewServer({
    inputs: [tracePath],
    host: "127.0.0.1",
    port: 0,
    projectRoot: dir,
    openBrowser: false
  });

  try {
    const response = await fetch(`${server.url}/api/annotation-attachment?path=${encodeURIComponent(attachmentPath)}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(await response.text(), "attachment body");
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects relative annotation attachment paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-"));
  const tracePath = path.join(dir, "trace.json");
  await writeFile(tracePath, JSON.stringify(sampleTrace(["first"])));
  const server = await startPreviewServer({
    inputs: [tracePath],
    host: "127.0.0.1",
    port: 0,
    projectRoot: dir,
    openBrowser: false
  });

  try {
    const response = await fetch(`${server.url}/api/annotation-attachment?path=relative.png`);
    assert.equal(response.status, 400);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function readModel(url: string): Promise<PreviewModel> {
  const response = await fetch(`${url}/api/traces`);
  assert.equal(response.status, 200);
  return (await response.json()) as PreviewModel;
}

async function waitForModelEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (model: PreviewModel) => boolean
): Promise<PreviewModel> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 4000;

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([reader.read(), delay(remaining).then(() => undefined)]);
    if (!result || result.done) {
      break;
    }

    buffer += decoder.decode(result.value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const model = parseModelEvent(event);
      if (model && predicate(model)) {
        await reader.cancel();
        return model;
      }
    }
  }

  await reader.cancel();
  throw new Error("Timed out waiting for model update event");
}

function parseModelEvent(event: string): PreviewModel | undefined {
  const lines = event.split("\n");
  const eventName = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
  if (eventName !== "model") {
    return undefined;
  }

  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  return JSON.parse(data) as PreviewModel;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
    testName: ["reloads"],
    attempt: 0
  };
}
