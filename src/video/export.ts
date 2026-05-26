import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultTerminalOutputPath,
  loadTerminalRenderSource,
  renderTerminalFramePng,
  terminalFrameDelay,
  type TerminalOverlayOptions,
  type TerminalOverlayPosition,
  type TerminalRenderOptions
} from "../media/terminal-render.js";

export type TerminalVideoOverlayPosition = TerminalOverlayPosition;
export type TerminalVideoOverlayOptions = TerminalOverlayOptions;
export type TerminalVideoFormat = "mp4" | "webm";

export const DEFAULT_TERMINAL_VIDEO_FPS = 60;
export const DEFAULT_TERMINAL_VIDEO_SCALE = 2;
export const DEFAULT_TERMINAL_VIDEO_MP4_CRF = 16;
export const DEFAULT_TERMINAL_VIDEO_WEBM_CRF = 28;

export type ExportTerminalVideoOptions = TerminalRenderOptions & {
  output?: string;
  format?: TerminalVideoFormat;
  ffmpegPath?: string;
  crf?: number;
  preset?: string;
  fps?: number;
};

export type ExportTerminalVideoResult = {
  outputPath: string;
  tracePath: string;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
  format: TerminalVideoFormat;
};

export async function exportTerminalVideo(options: ExportTerminalVideoOptions): Promise<ExportTerminalVideoResult> {
  const format = resolveVideoFormat(options.output, options.format);
  const renderOptions = {
    ...options,
    scale: options.scale ?? DEFAULT_TERMINAL_VIDEO_SCALE
  };
  const source = await loadTerminalRenderSource(renderOptions, { evenDimensions: true });
  const outputPath = path.resolve(options.output ?? defaultTerminalOutputPath(source.tracePath, format));
  const ffmpegPath = await resolveFfmpegPath(options.ffmpegPath);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tui-replay-video-"));

  try {
    const frameRate = options.fps ?? DEFAULT_TERMINAL_VIDEO_FPS;
    const framePattern = await writeVideoFrames(tempDir, source.frames, source.metrics, renderOptions, frameRate);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await runFfmpeg(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      String(frameRate),
      "-i",
      framePattern,
      ...videoCodecArgs(format, options),
      outputPath
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    outputPath,
    tracePath: source.tracePath,
    frameCount: source.frames.length,
    width: source.metrics.width,
    height: source.metrics.height,
    durationMs: source.durationMs,
    format
  };
}

export async function resolveFfmpegPath(explicitPath?: string): Promise<string> {
  const configuredPath = explicitPath || process.env.TUI_REPLAY_FFMPEG || process.env.FFMPEG_PATH || process.env.FFMPEG_BIN;
  if (configuredPath) {
    await assertExecutable(configuredPath);
    return configuredPath;
  }

  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) {
      continue;
    }

    const candidate = path.join(dir, binaryName);
    try {
      await assertExecutable(candidate);
      return candidate;
    } catch {
      // Keep scanning PATH.
    }
  }

  throw new Error("Unable to find ffmpeg. Install ffmpeg, set TUI_REPLAY_FFMPEG, or pass --ffmpeg-path.");
}

async function writeVideoFrames(
  tempDir: string,
  frames: Awaited<ReturnType<typeof loadTerminalRenderSource>>["frames"],
  metrics: Awaited<ReturnType<typeof loadTerminalRenderSource>>["metrics"],
  options: ExportTerminalVideoOptions,
  frameRate: number
): Promise<string> {
  let outputIndex = 0;

  for (const [index, frame] of frames.entries()) {
    const png = renderTerminalFramePng(frame, metrics);
    const repeat = Math.max(1, Math.round((terminalFrameDelay(frames, index, options) / 1000) * frameRate));

    for (let i = 0; i < repeat; i += 1) {
      await writeFile(path.join(tempDir, `frame-${String(outputIndex).padStart(5, "0")}.png`), png);
      outputIndex += 1;
    }
  }

  return path.join(tempDir, "frame-%05d.png");
}

function videoCodecArgs(format: TerminalVideoFormat, options: ExportTerminalVideoOptions): string[] {
  if (format === "webm") {
    return ["-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(options.crf ?? DEFAULT_TERMINAL_VIDEO_WEBM_CRF), "-pix_fmt", "yuv420p"];
  }

  return [
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    options.preset ?? "medium",
    "-crf",
    String(options.crf ?? DEFAULT_TERMINAL_VIDEO_MP4_CRF),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart"
  ];
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const message = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`ffmpeg exited with code ${code}${message ? `: ${message}` : ""}`));
    });
  });
}

async function assertExecutable(filePath: string): Promise<void> {
  await access(filePath, 1);
}

function resolveVideoFormat(outputPath: string | undefined, explicitFormat: TerminalVideoFormat | undefined): TerminalVideoFormat {
  if (explicitFormat) {
    return explicitFormat;
  }

  const extension = outputPath ? path.extname(outputPath).toLowerCase() : "";
  if (extension === ".webm") {
    return "webm";
  }

  return "mp4";
}
