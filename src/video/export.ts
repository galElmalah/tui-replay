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
export const FFMPEG_NOT_FOUND_CODE = "TUI_REPLAY_FFMPEG_NOT_FOUND";

type FfmpegCandidate = {
  source: string;
  value: string;
};

export class FfmpegResolutionError extends Error {
  readonly code = FFMPEG_NOT_FOUND_CODE;
  readonly attempts: string[];

  constructor(message: string, attempts: string[]) {
    super(message);
    this.name = "FfmpegResolutionError";
    this.attempts = attempts;
  }
}

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

export async function resolveFfmpegPath(explicitPath?: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configuredCandidate = firstConfiguredFfmpegCandidate(explicitPath, env);
  if (configuredCandidate) {
    try {
      await assertExecutable(configuredCandidate.value);
      return configuredCandidate.value;
    } catch (error) {
      throw new FfmpegResolutionError(
        formatConfiguredFfmpegError(configuredCandidate, error),
        [`${configuredCandidate.source}: ${configuredCandidate.value}`]
      );
    }
  }

  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const pathEntries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const attempts = [
    "--ffmpeg-path: not provided",
    "TUI_REPLAY_FFMPEG: not set",
    "FFMPEG_PATH: not set",
    "FFMPEG_BIN: not set",
    ...pathEntries.map((dir) => path.join(dir, binaryName))
  ];

  for (const dir of pathEntries) {
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

  throw new FfmpegResolutionError(formatMissingFfmpegError(binaryName, pathEntries), attempts);
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

function firstConfiguredFfmpegCandidate(explicitPath: string | undefined, env: NodeJS.ProcessEnv): FfmpegCandidate | undefined {
  if (explicitPath) {
    return { source: "--ffmpeg-path", value: explicitPath };
  }

  if (env.TUI_REPLAY_FFMPEG) {
    return { source: "TUI_REPLAY_FFMPEG", value: env.TUI_REPLAY_FFMPEG };
  }

  if (env.FFMPEG_PATH) {
    return { source: "FFMPEG_PATH", value: env.FFMPEG_PATH };
  }

  if (env.FFMPEG_BIN) {
    return { source: "FFMPEG_BIN", value: env.FFMPEG_BIN };
  }

  return undefined;
}

function formatConfiguredFfmpegError(candidate: FfmpegCandidate, error: unknown): string {
  return [
    `Unable to use ffmpeg for TUI Replay video export. Error code: ${FFMPEG_NOT_FOUND_CODE}.`,
    "",
    "The configured ffmpeg binary does not exist or is not executable.",
    `Checked ${candidate.source}: ${candidate.value}`,
    `Failure: ${formatErrorReason(error)}`,
    "",
    formatFfmpegFixBlock()
  ].join("\n");
}

function formatMissingFfmpegError(binaryName: string, pathEntries: string[]): string {
  return [
    `Unable to find ffmpeg for TUI Replay video export. Error code: ${FFMPEG_NOT_FOUND_CODE}.`,
    "",
    "Checked:",
    "- --ffmpeg-path: not provided",
    "- TUI_REPLAY_FFMPEG: not set",
    "- FFMPEG_PATH: not set",
    "- FFMPEG_BIN: not set",
    `- PATH entries for ${binaryName}: ${formatPathEntries(pathEntries)}`,
    "",
    formatFfmpegFixBlock()
  ].join("\n");
}

function formatFfmpegFixBlock(): string {
  return [
    "How to fix:",
    "- Install ffmpeg and rerun the same command.",
    "- macOS: brew install ffmpeg",
    "- Ubuntu/Debian: sudo apt-get install ffmpeg",
    "- Or pass --ffmpeg-path /absolute/path/to/ffmpeg",
    "- Or set TUI_REPLAY_FFMPEG=/absolute/path/to/ffmpeg",
    "- Also supported: FFMPEG_PATH or FFMPEG_BIN",
    "- If video is not required, use `tui-replay gif ...`; GIF export does not require ffmpeg.",
    "",
    "Agent hint: treat TUI_REPLAY_FFMPEG_NOT_FOUND as a missing system dependency. Install ffmpeg or retry with --ffmpeg-path."
  ].join("\n");
}

function formatPathEntries(pathEntries: string[]): string {
  if (pathEntries.length === 0) {
    return "(empty PATH)";
  }

  const maxEntries = 12;
  const visibleEntries = pathEntries.slice(0, maxEntries).join(path.delimiter);
  const remaining = pathEntries.length - maxEntries;
  return remaining > 0 ? `${visibleEntries}${path.delimiter}... (${remaining} more)` : visibleEntries;
}

function formatErrorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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
