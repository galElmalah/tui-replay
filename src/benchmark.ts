#!/usr/bin/env node
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { exportTerminalGif } from "./gif/export.js";
import { loadTerminalRenderSource, renderTerminalFramePixels, type TerminalRenderOptions } from "./media/terminal-render.js";
import { writeTraceAnnotations } from "./sdk.js";

type BenchmarkOptions = {
  trace: string;
  iterations: number;
  gifIterations: number;
  gifWorkers?: number;
  syntheticAnnotation: boolean;
};

type BenchmarkResult = {
  label: string;
  iterations: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  unitCount?: number;
  unitName?: string;
};

const options = parseArgs(process.argv.slice(2));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tui-replay-benchmark-"));

try {
  const trace = await prepareTraceInput(options.trace, options.syntheticAnnotation, tempRoot);
  const baseRenderOptions: TerminalRenderOptions = {
    input: trace.input,
    fontSize: 12,
    lastDelayMs: 250,
    overlay: false
  };
  const plainSource = await loadTerminalRenderSource(baseRenderOptions);
  const overlaySource = await loadTerminalRenderSource({
    ...baseRenderOptions,
    overlay: { position: "bottom-right" }
  });
  const outputDir = path.join(tempRoot, "out");
  const gifWorkerLabel = formatWorkerLabel(options.gifWorkers);

  process.stdout.write(`TUI Replay benchmark\n`);
  process.stdout.write(`Trace: ${trace.displayPath}\n`);
  if (trace.syntheticAnnotation) {
    process.stdout.write(`Annotation: synthetic sidecar in ${path.dirname(trace.input)}\n`);
  }
  process.stdout.write(
    `Frames: ${plainSource.frames.length} | Duration: ${formatDuration(plainSource.durationMs)} | Size: ${plainSource.metrics.width}x${plainSource.metrics.height}\n`
  );
  process.stdout.write(`Iterations: render=${options.iterations}, gif=${options.gifIterations}\n`);
  process.stdout.write(`GIF workers: sequential=1, parallel=${gifWorkerLabel}\n\n`);

  const results: BenchmarkResult[] = [];
  results.push(
    await benchmark("load + render trace source", options.iterations, async () => {
      await loadTerminalRenderSource(baseRenderOptions);
    })
  );
  results.push(
    await benchmark(
      "render pixels, no overlay",
      options.iterations,
      () => {
        for (const frame of plainSource.frames) {
          renderTerminalFramePixels(frame, plainSource.metrics);
        }
      },
      plainSource.frames.length,
      "frames"
    )
  );
  results.push(
    await benchmark(
      "render pixels, annotation overlay",
      options.iterations,
      () => {
        for (const frame of overlaySource.frames) {
          renderTerminalFramePixels(
            frame,
            overlaySource.metrics,
            overlaySource.annotations.filter((annotation) => annotation.frameIndex === frame.index)
          );
        }
      },
      overlaySource.frames.length,
      "frames"
    )
  );
  if (options.gifIterations > 0) {
    results.push(
      await benchmark("gif export, no overlay, row deltas", options.gifIterations, async (iteration) => {
        await exportTerminalGif({
          ...baseRenderOptions,
          output: path.join(outputDir, `plain-sequential-${iteration}.gif`),
          overlay: false,
          repeat: -1,
          workers: 1
        });
      })
    );
    results.push(
      await benchmark(`gif export, annotation overlay, ${gifWorkerLabel}`, options.gifIterations, async (iteration) => {
        await exportTerminalGif({
          ...baseRenderOptions,
          output: path.join(outputDir, `overlay-${iteration}.gif`),
          overlay: { position: "bottom-right" },
          repeat: -1,
          workers: options.gifWorkers
        });
      })
    );
  }

  printResults(results);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function prepareTraceInput(tracePath: string, syntheticAnnotation: boolean, tempRoot: string): Promise<{
  input: string;
  displayPath: string;
  syntheticAnnotation: boolean;
}> {
  const resolved = path.resolve(tracePath);
  if (!syntheticAnnotation) {
    return { input: resolved, displayPath: resolved, syntheticAnnotation: false };
  }

  const stats = await stat(resolved);
  if (!stats.isFile()) {
    return { input: resolved, displayPath: resolved, syntheticAnnotation: false };
  }

  const copyPath = path.join(tempRoot, path.basename(resolved));
  await copyFile(resolved, copyPath);
  await writeTraceAnnotations(copyPath, [
    {
      frameIndex: 0,
      label: "Benchmark annotation for overlay rendering with a moderately long label",
      kind: "benchmark",
      assertions: [{ label: "overlay is rendered", passed: true }]
    }
  ]);

  return { input: copyPath, displayPath: resolved, syntheticAnnotation: true };
}

async function benchmark(
  label: string,
  iterations: number,
  fn: (iteration: number) => void | Promise<void>,
  unitCount?: number,
  unitName?: string
): Promise<BenchmarkResult> {
  await fn(-1);
  const durations: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const start = performance.now();
    await fn(iteration);
    durations.push(performance.now() - start);
  }

  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    label,
    iterations,
    meanMs: total / durations.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    unitCount,
    unitName
  };
}

function printResults(results: BenchmarkResult[]): void {
  const labelWidth = Math.max(36, ...results.map((result) => result.label.length));
  process.stdout.write(`${"benchmark".padEnd(labelWidth)} ${"mean".padStart(10)} ${"min".padStart(10)} ${"max".padStart(10)} ${"throughput".padStart(16)}\n`);
  process.stdout.write(`${"-".repeat(labelWidth + 50)}\n`);
  for (const result of results) {
    const throughput =
      result.unitCount && result.unitName ? `${formatNumber(result.unitCount / (result.meanMs / 1000))} ${result.unitName}/s` : `${formatNumber(1000 / result.meanMs)} runs/s`;
    process.stdout.write(
      `${result.label.padEnd(labelWidth)} ${formatMs(result.meanMs).padStart(10)} ${formatMs(result.minMs).padStart(10)} ${formatMs(result.maxMs).padStart(10)} ${throughput.padStart(16)}\n`
    );
  }
}

function parseArgs(args: string[]): BenchmarkOptions {
  const parsed: BenchmarkOptions = {
    trace: "examples/simple.tui-trace.json",
    iterations: 25,
    gifIterations: 5,
    syntheticAnnotation: true
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--trace":
        parsed.trace = requiredValue(args, ++index, arg);
        break;
      case "--iterations":
        parsed.iterations = parsePositiveInteger(requiredValue(args, ++index, arg), arg);
        break;
      case "--gif-iterations":
        parsed.gifIterations = parseNonNegativeInteger(requiredValue(args, ++index, arg), arg);
        break;
      case "--gif-workers":
        parsed.gifWorkers = parsePositiveInteger(requiredValue(args, ++index, arg), arg);
        break;
      case "--no-synthetic-annotation":
        parsed.syntheticAnnotation = false;
        break;
      case "-h":
      case "--help":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown benchmark option: ${arg}`);
    }
  }

  return parsed;
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function printHelpAndExit(): never {
  process.stdout.write(`Usage: npm run benchmark -- [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --trace <file>                Trace file to benchmark. Default: examples/simple.tui-trace.json\n`);
  process.stdout.write(`  --iterations <count>          Render benchmark iterations. Default: 25\n`);
  process.stdout.write(`  --gif-iterations <count>      GIF export benchmark iterations; 0 skips GIF export. Default: 5\n`);
  process.stdout.write(`  --gif-workers <count>         Worker count for parallel GIF export rows. Default: auto.\n`);
  process.stdout.write(`  --no-synthetic-annotation     Do not create a temporary annotation sidecar for overlay benchmarks.\n`);
  process.stdout.write(`  -h, --help                    Show help.\n`);
  process.exit(0);
}

function formatMs(value: number): string {
  return `${value.toFixed(value >= 100 ? 1 : 2)}ms`;
}

function formatNumber(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatWorkerLabel(workers: number | undefined): string {
  if (workers === undefined) {
    return "auto workers";
  }
  return `${workers} worker${workers === 1 ? "" : "s"}`;
}

function formatDuration(timeMs: number): string {
  if (timeMs < 1000) {
    return `${Math.round(timeMs)}ms`;
  }
  return `${(timeMs / 1000).toFixed(2)}s`;
}
