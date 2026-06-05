import { parentPort } from "node:worker_threads";
import gifenc, { type GifPalette } from "gifenc";
import { renderTerminalFramePixels, type TerminalRenderMetrics } from "../media/terminal-render.js";
import type { RenderedFrame, ResolvedTraceAnnotation } from "../trace/types.js";

type GifFrameWorkerTask = {
  id: number;
  frame: RenderedFrame;
  metrics: TerminalRenderMetrics;
  annotations: ResolvedTraceAnnotation[];
};

type GifFrameWorkerResult = {
  id: number;
  indexed: Uint8Array;
  palette: GifPalette;
};

type GifFrameWorkerError = {
  id: number;
  error: string;
  stack?: string;
};

if (!parentPort) {
  throw new Error("GIF frame worker must be started from a worker thread.");
}

parentPort.on("message", (task: GifFrameWorkerTask) => {
  try {
    const pixels = renderTerminalFramePixels(task.frame, task.metrics, task.annotations);
    const palette = gifenc.quantize(pixels, 256, { format: "rgb565" });
    const indexed = gifenc.applyPalette(pixels, palette, "rgb565");
    const transferable = Uint8Array.from(indexed);
    const result: GifFrameWorkerResult = {
      id: task.id,
      indexed: transferable,
      palette
    };

    parentPort?.postMessage(result, [transferable.buffer]);
  } catch (error) {
    const failure: GifFrameWorkerError = {
      id: task.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    };
    parentPort?.postMessage(failure);
  }
});
