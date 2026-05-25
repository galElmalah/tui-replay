import path from "node:path";
import { extractSourceDetails } from "../source/expectations.js";
import { loadResolvedTraceAnnotations } from "../trace/annotations.js";
import { loadTraceInputs } from "../trace/load.js";
import { renderTraceFrames } from "../trace/render.js";
import type { PreviewModel, TraceReplay, TraceSummary } from "../trace/types.js";

export async function buildPreviewModel(inputs: string[], projectRoot: string): Promise<PreviewModel> {
  const loaded = await loadTraceInputs(inputs);
  const traces: TraceReplay[] = [];

  for (const [index, item] of loaded.entries()) {
    const frames = await renderTraceFrames(item.trace);
    const annotations = await loadResolvedTraceAnnotations(item.filePath, frames);
    const details = await extractSourceDetails(item.trace, projectRoot);
    traces.push({
      summary: summarizeTrace(item.filePath, item.trace, frames, index, details.sourceFile, details.sourceLine),
      frames,
      annotations,
      details
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    traces
  };
}

function summarizeTrace(
  filePath: string,
  trace: { testName?: string[]; attempt?: number },
  frames: TraceReplay["frames"],
  index: number,
  sourceFile?: string,
  sourceLine?: number
): TraceSummary {
  const lastFrame = frames.at(-1);
  return {
    id: `trace-${index}`,
    filePath,
    fileName: path.basename(filePath),
    testTitle: trace.testName?.join(" > ") || path.basename(filePath),
    testFile: sourceFile,
    sourceLine,
    attempt: trace.attempt,
    durationMs: lastFrame?.time ?? 0,
    frameCount: frames.length,
    rows: lastFrame?.rows ?? 0,
    cols: lastFrame?.cols ?? 0
  };
}
