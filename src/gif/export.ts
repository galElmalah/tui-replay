import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import gifenc, { type GifPalette } from "gifenc";
import {
  defaultTerminalOutputPath,
  loadTerminalRenderSource,
  renderTerminalFramePixels,
  terminalFrameDelay,
  type TerminalOverlayOptions,
  type TerminalOverlayPosition,
  type TerminalRenderMetrics,
  type TerminalRenderOptions
} from "../media/terminal-render.js";
import type { RenderedFrame, ResolvedTraceAnnotation } from "../trace/types.js";

export type TerminalGifOverlayPosition = TerminalOverlayPosition;
export type TerminalGifOverlayOptions = TerminalOverlayOptions;

export type ExportTerminalGifOptions = TerminalRenderOptions & {
  output?: string;
  repeat?: number;
  workers?: number;
};

export type ExportTerminalGifResult = {
  outputPath: string;
  tracePath: string;
  frameCount: number;
  encodedFrameCount: number;
  width: number;
  height: number;
  durationMs: number;
  workers: number;
};

export async function exportTerminalGif(options: ExportTerminalGifOptions): Promise<ExportTerminalGifResult> {
  const source = await loadTerminalRenderSource(options);
  const outputPath = path.resolve(options.output ?? defaultTerminalOutputPath(source.tracePath, "gif"));
  const encoder = gifenc.GIFEncoder({ initialCapacity: source.metrics.width * source.metrics.height });
  const workerCount = resolveGifWorkerCount(options.workers, source.frames.length);
  const frames = await prepareGifFrames(source.frames, source.metrics, source.annotations, options, workerCount);

  for (const frame of frames) {
    encoder.writeFrame(frame.indexed, source.metrics.width, source.metrics.height, {
      palette: frame.palette,
      delay: frame.delay,
      repeat: options.repeat ?? 0
    });
  }

  encoder.finish();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, encoder.bytes());

  return {
    outputPath,
    tracePath: source.tracePath,
    frameCount: source.frames.length,
    encodedFrameCount: frames.length,
    width: source.metrics.width,
    height: source.metrics.height,
    durationMs: source.durationMs,
    workers: workerCount
  };
}

type PreparedGifFrame = {
  indexed: Uint8Array;
  palette: GifPalette;
  delay: number;
  signature: string;
};

type GifFrameWorkerResult = {
  id: number;
  indexed: Uint8Array;
  palette: GifPalette;
};

type GifFrameWorkerFailure = {
  id: number;
  error: string;
  stack?: string;
};

async function prepareGifFrames(
  frames: RenderedFrame[],
  metrics: TerminalRenderMetrics,
  annotations: ResolvedTraceAnnotation[],
  options: TerminalRenderOptions,
  workerCount: number
): Promise<PreparedGifFrame[]> {
  const annotationsByFrame = groupAnnotationsByFrame(annotations);
  const canReuseSurfaces = !metrics.overlay.enabled;
  const tasks = createGifFrameTasks(frames, annotationsByFrame, canReuseSurfaces);
  const preparedByTask =
    workerCount <= 1 || tasks.length <= 1
      ? tasks.map((task) => prepareGifFrame(task.frame, metrics, task.annotations))
      : await prepareGifFrameTasksInWorkers(tasks, metrics, workerCount);

  const preparedBySignature = new Map<string, Omit<PreparedGifFrame, "delay" | "signature">>();
  for (const [index, task] of tasks.entries()) {
    preparedBySignature.set(task.signature, preparedByTask[index]);
  }

  const preparedFrames = frames.map((frame, index) => {
    const signature = canReuseSurfaces ? frameSurfaceSignature(frame) : String(index);
    const prepared = preparedBySignature.get(signature);
    if (!prepared) {
      throw new Error(`Missing prepared GIF frame for frame ${index + 1}.`);
    }
    return {
      ...prepared,
      delay: terminalFrameDelay(frames, index, options),
      signature
    };
  });

  return canReuseSurfaces ? compactConsecutiveGifFrames(preparedFrames) : preparedFrames;
}

function prepareGifFrame(frame: RenderedFrame, metrics: TerminalRenderMetrics, annotations: ResolvedTraceAnnotation[]): Omit<PreparedGifFrame, "delay" | "signature"> {
  const pixels = renderTerminalFramePixels(frame, metrics, annotations);
  const palette = gifenc.quantize(pixels, 256, { format: "rgb565" });
  const indexed = gifenc.applyPalette(pixels, palette, "rgb565");
  return { indexed, palette };
}

type GifFrameTask = {
  frame: RenderedFrame;
  annotations: ResolvedTraceAnnotation[];
  signature: string;
};

function prepareGifFrameTasksInWorkers(
  tasks: GifFrameTask[],
  metrics: TerminalRenderMetrics,
  workerCount: number
): Promise<Array<Omit<PreparedGifFrame, "delay" | "signature">>> {
  const workerUrl = new URL("./frame-worker.js", import.meta.url);
  const prepared: Array<Omit<PreparedGifFrame, "delay" | "signature">> = new Array(tasks.length);
  const workers: Worker[] = [];
  let nextIndex = 0;
  let completed = 0;
  let settled = false;

  return new Promise((resolve, reject) => {
    const stopWorkers = () => {
      void Promise.all(workers.map((worker) => worker.terminate()));
    };

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      stopWorkers();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      Promise.all(workers.map((worker) => worker.terminate()))
        .then(() => resolve(prepared))
        .catch((error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
    };

    const assignNext = (worker: Worker) => {
      if (nextIndex >= tasks.length) {
        return;
      }

      const index = nextIndex;
      const task = tasks[index];
      nextIndex += 1;
      worker.postMessage({
        id: index,
        frame: task.frame,
        metrics,
        annotations: task.annotations
      });
    };

    const handleMessage = (worker: Worker, message: GifFrameWorkerResult | GifFrameWorkerFailure) => {
      if (settled) {
        return;
      }

      if ("error" in message) {
        const error = new Error(`GIF frame ${message.id + 1} failed: ${message.error}`);
        if (message.stack) {
          error.stack = message.stack;
        }
        rejectOnce(error);
        return;
      }

      prepared[message.id] = {
        indexed: message.indexed,
        palette: message.palette
      };
      completed += 1;

      if (completed >= tasks.length) {
        resolveOnce();
        return;
      }

      assignNext(worker);
    };

    try {
      for (let index = 0; index < workerCount; index += 1) {
        const worker = new Worker(workerUrl);
        workers.push(worker);
        worker.on("message", (message: GifFrameWorkerResult | GifFrameWorkerFailure) => handleMessage(worker, message));
        worker.on("error", rejectOnce);
        worker.on("exit", (code) => {
          if (!settled && code !== 0) {
            rejectOnce(new Error(`GIF frame worker exited with code ${code}.`));
          }
        });
      }
    } catch (error) {
      rejectOnce(error);
      return;
    }

    for (const worker of workers) {
      assignNext(worker);
    }
  });
}

function groupAnnotationsByFrame(annotations: ResolvedTraceAnnotation[]): Map<number, ResolvedTraceAnnotation[]> {
  const grouped = new Map<number, ResolvedTraceAnnotation[]>();

  for (const annotation of annotations) {
    const group = grouped.get(annotation.frameIndex);
    if (group) {
      group.push(annotation);
    } else {
      grouped.set(annotation.frameIndex, [annotation]);
    }
  }

  return grouped;
}

function createGifFrameTasks(
  frames: RenderedFrame[],
  annotationsByFrame: Map<number, ResolvedTraceAnnotation[]>,
  canReuseSurfaces: boolean
): GifFrameTask[] {
  if (!canReuseSurfaces) {
    return frames.map((frame, index) => ({
      frame,
      annotations: annotationsByFrame.get(frame.index) ?? [],
      signature: String(index)
    }));
  }

  const seen = new Set<string>();
  const tasks: GifFrameTask[] = [];

  for (const frame of frames) {
    const signature = frameSurfaceSignature(frame);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    tasks.push({
      frame,
      annotations: annotationsByFrame.get(frame.index) ?? [],
      signature
    });
  }

  return tasks;
}

function compactConsecutiveGifFrames(frames: PreparedGifFrame[]): PreparedGifFrame[] {
  const compacted: PreparedGifFrame[] = [];

  for (const frame of frames) {
    const previous = compacted.at(-1);
    if (previous && previous.signature === frame.signature) {
      previous.delay += frame.delay;
      continue;
    }
    compacted.push({ ...frame });
  }

  return compacted;
}

function frameSurfaceSignature(frame: RenderedFrame): string {
  const parts = [`${frame.rows}x${frame.cols}`];

  for (const row of frame.lines) {
    parts.push("\n");
    for (const segment of row) {
      parts.push(
        segment.text,
        "\u0001",
        segment.fg ?? "",
        "\u0001",
        segment.bg ?? "",
        "\u0001",
        segment.bold ? "1" : "0",
        segment.dim ? "1" : "0",
        segment.italic ? "1" : "0",
        segment.underline ? "1" : "0",
        segment.inverse ? "1" : "0",
        segment.cursor ? "1" : "0",
        "\u0002"
      );
    }
  }

  return parts.join("");
}

function resolveGifWorkerCount(requestedWorkers: number | undefined, frameCount: number): number {
  if (frameCount <= 1) {
    return 1;
  }

  if (requestedWorkers !== undefined) {
    return clampWorkerCount(requestedWorkers, frameCount);
  }

  return clampWorkerCount(Math.min(4, Math.max(1, availableParallelism() - 1)), frameCount);
}

function clampWorkerCount(workerCount: number, frameCount: number): number {
  return Math.max(1, Math.min(frameCount, Math.floor(workerCount)));
}
