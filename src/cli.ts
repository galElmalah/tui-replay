#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { startPreviewServer } from "./server/preview-server.js";
import type { TerminalGifOverlayPosition } from "./gif/export.js";

const program = new Command();

program
  .name("tui-replay")
  .description("Replay viewer for @microsoft/tui-test traces.")
  .version("0.2.0");

program
  .command("preview")
  .description("serve a browser replay for one or more tui-test traces")
  .argument("<trace...>", "trace file or directory")
  .option("-p, --port <port>", "port to bind", parsePort, 4390)
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--project <dir>", "project root for resolving test files", process.cwd())
  .option("--no-watch", "disable live trace file watching")
  .option("--no-open", "do not open the browser")
  .action(async (inputs: string[], options: { port: number; host: string; project: string; watch: boolean; open: boolean }) => {
    const server = await startPreviewServer({
      inputs,
      host: options.host,
      port: options.port,
      projectRoot: options.project,
      watch: options.watch,
      openBrowser: options.open
    });

    process.stdout.write(`TUI Replay preview: ${server.url}\n`);
    process.stdout.write("Press Ctrl+C to stop.\n");

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

program
  .command("gif")
  .description("export the terminal replay surface to an animated GIF")
  .argument("<trace>", "trace file or directory")
  .option("-o, --output <file>", "output GIF path")
  .option("--trace-index <index>", "trace index to export when the input resolves to multiple traces", parseNonNegativeInteger, 0)
  .option("--speed <rate>", "playback speed multiplier", parsePositiveNumber, 1)
  .option("--repeat <count>", "GIF repeat count: 0 forever, -1 once, or a positive repeat count", parseRepeatCount, 0)
  .option("--min-delay <ms>", "minimum frame delay", parsePositiveNumber, 20)
  .option("--last-delay <ms>", "delay for the final frame", parsePositiveNumber, 1000)
  .option("--scale <scale>", "output scale multiplier", parsePositiveNumber, 1)
  .option("--font-size <px>", "terminal font size before scale", parsePositiveNumber, 14)
  .option("--cell-width <px>", "terminal cell width before scale", parsePositiveNumber)
  .option("--line-height <px>", "terminal line height before scale", parsePositiveNumber)
  .option("--padding <px>", "terminal padding before scale", parseNonNegativeNumber)
  .option("--font-family <family>", "terminal font family", "Menlo, Monaco, Consolas, monospace")
  .option("--overlay", "draw frame and timestamp metadata over the exported terminal GIF")
  .option("--overlay-position <position>", "overlay position: top-left, top-right, bottom-left, or bottom-right", parseOverlayPosition, "bottom-right")
  .option("--overlay-background <color>", "overlay background color", "#05080c")
  .option("--overlay-foreground <color>", "overlay foreground color", "#f8fafc")
  .action(
    async (
      input: string,
      options: {
        output?: string;
        traceIndex: number;
        speed: number;
        repeat: number;
        minDelay: number;
        lastDelay: number;
        scale: number;
        fontSize: number;
        cellWidth?: number;
        lineHeight?: number;
        padding?: number;
        fontFamily: string;
        overlay?: boolean;
        overlayPosition: TerminalGifOverlayPosition;
        overlayBackground: string;
        overlayForeground: string;
      }
    ) => {
      const { exportTerminalGif } = await import("./gif/export.js");
      const result = await exportTerminalGif({
        input,
        output: options.output,
        traceIndex: options.traceIndex,
        speed: options.speed,
        repeat: options.repeat,
        minDelayMs: options.minDelay,
        lastDelayMs: options.lastDelay,
        scale: options.scale,
        fontSize: options.fontSize,
        cellWidth: options.cellWidth,
        lineHeight: options.lineHeight,
        padding: options.padding,
        fontFamily: options.fontFamily,
        overlay: options.overlay
          ? {
              position: options.overlayPosition,
              background: options.overlayBackground,
              foreground: options.overlayForeground
            }
          : false
      });

      process.stdout.write(`Wrote ${result.outputPath}\n`);
      process.stdout.write(
        `Trace: ${result.tracePath}\nFrames: ${result.frameCount} | Duration: ${formatDuration(result.durationMs)} | Size: ${result.width}x${result.height}\n`
      );
    }
  );

program
  .command("tui")
  .description("replay tui-test traces inside a terminal UI powered by OpenTUI")
  .argument("<trace...>", "trace file or directory")
  .option("--project <dir>", "project root for resolving test files", process.cwd())
  .action(async (inputs: string[], options: { project: string }) => {
    if (!isBunRuntime()) {
      await rerunCurrentCommandWithBun();
      return;
    }

    const { startOpenTuiPreview } = await import("./tui/open-tui-preview.js");
    await startOpenTuiPreview({
      inputs,
      projectRoot: options.project
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer: ${value}`);
  }
  return parsed;
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive number: ${value}`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative number: ${value}`);
  }
  return parsed;
}

function parseRepeatCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -1) {
    throw new Error(`Invalid repeat count: ${value}`);
  }
  return parsed;
}

function parseOverlayPosition(value: string): TerminalGifOverlayPosition {
  if (value === "top-left" || value === "top-right" || value === "bottom-left" || value === "bottom-right") {
    return value;
  }
  throw new Error(`Invalid overlay position: ${value}`);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function isBunRuntime(): boolean {
  return typeof process.versions === "object" && "bun" in process.versions;
}

function rerunCurrentCommandWithBun(): Promise<void> {
  const cliPath = fileURLToPath(import.meta.url);
  const child = spawn("bun", [cliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env
  });

  return new Promise((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("The OpenTUI preview requires Bun or Node.js with FFI enabled. Install Bun, then rerun this command."));
        return;
      }
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}
