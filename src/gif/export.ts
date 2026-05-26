import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import gifenc from "gifenc";
import { loadTraceInputs } from "../trace/load.js";
import { renderTraceFrames } from "../trace/render.js";
import type { RenderedFrame } from "../trace/types.js";

const DEFAULT_BACKGROUND = "#101318";
const DEFAULT_FOREGROUND = "#e4e7eb";
const DEFAULT_CURSOR = "#f8fafc";
const DEFAULT_FONT_FAMILY = "Menlo, Monaco, Consolas, monospace";

export type ExportTerminalGifOptions = {
  input: string | string[];
  output?: string;
  traceIndex?: number;
  speed?: number;
  repeat?: number;
  minDelayMs?: number;
  lastDelayMs?: number;
  scale?: number;
  fontSize?: number;
  cellWidth?: number;
  lineHeight?: number;
  padding?: number;
  fontFamily?: string;
  background?: string;
  foreground?: string;
  cursorColor?: string;
};

export type ExportTerminalGifResult = {
  outputPath: string;
  tracePath: string;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
};

type TerminalGifTheme = {
  background: string;
  foreground: string;
  cursorColor: string;
};

type TerminalGifMetrics = {
  rows: number;
  cols: number;
  width: number;
  height: number;
  fontSize: number;
  cellWidth: number;
  lineHeight: number;
  padding: number;
  fontFamily: string;
  theme: TerminalGifTheme;
};

export async function exportTerminalGif(options: ExportTerminalGifOptions): Promise<ExportTerminalGifResult> {
  const inputs = Array.isArray(options.input) ? options.input : [options.input];
  const traces = await loadTraceInputs(inputs);
  const traceIndex = options.traceIndex ?? 0;
  const selected = traces[traceIndex];

  if (!selected) {
    throw new Error(`Trace index ${traceIndex} is out of range. Found ${traces.length} trace${traces.length === 1 ? "" : "s"}.`);
  }

  const frames = await renderTraceFrames(selected.trace);
  if (frames.length === 0) {
    throw new Error(`Trace has no renderable frames: ${selected.filePath}`);
  }

  const metrics = createMetrics(frames, options);
  const outputPath = path.resolve(options.output ?? defaultOutputPath(selected.filePath));
  const bytes = encodeTerminalGif(frames, metrics, options);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);

  return {
    outputPath,
    tracePath: selected.filePath,
    frameCount: frames.length,
    width: metrics.width,
    height: metrics.height,
    durationMs: frames.at(-1)?.time ?? 0
  };
}

function encodeTerminalGif(frames: RenderedFrame[], metrics: TerminalGifMetrics, options: ExportTerminalGifOptions): Uint8Array {
  const encoder = gifenc.GIFEncoder({ initialCapacity: metrics.width * metrics.height });

  for (const [index, frame] of frames.entries()) {
    const pixels = renderFramePixels(frame, metrics);
    const palette = gifenc.quantize(pixels, 256, { format: "rgb565" });
    const indexed = gifenc.applyPalette(pixels, palette, "rgb565");
    encoder.writeFrame(indexed, metrics.width, metrics.height, {
      palette,
      delay: frameDelay(frames, index, options),
      repeat: options.repeat ?? 0
    });
  }

  encoder.finish();
  return encoder.bytes();
}

function renderFramePixels(frame: RenderedFrame, metrics: TerminalGifMetrics): Buffer {
  const svg = terminalFrameToSvg(frame, metrics);
  return new Resvg(svg, {
    font: {
      loadSystemFonts: true,
      defaultFontFamily: metrics.fontFamily,
      defaultFontSize: metrics.fontSize,
      monospaceFamily: metrics.fontFamily
    },
    shapeRendering: 1,
    textRendering: 0,
    background: metrics.theme.background
  })
    .render()
    .pixels;
}

function terminalFrameToSvg(frame: RenderedFrame, metrics: TerminalGifMetrics): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${metrics.width}" height="${metrics.height}" viewBox="0 0 ${metrics.width} ${metrics.height}">`,
    `<rect width="100%" height="100%" fill="${escapeAttribute(metrics.theme.background)}"/>`
  ];

  for (let row = 0; row < metrics.rows; row += 1) {
    const segments = frame.lines[row] ?? [{ text: " " }];
    let col = 0;

    for (const segment of segments) {
      const text = segment.text || " ";
      const length = cellLength(text);
      const x = metrics.padding + col * metrics.cellWidth;
      const y = metrics.padding + row * metrics.lineHeight;
      const background = segment.cursor ? metrics.theme.cursorColor : segment.bg;

      if (background) {
        parts.push(
          `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(length * metrics.cellWidth)}" height="${formatNumber(metrics.lineHeight)}" fill="${escapeAttribute(background)}"/>`
        );
      }

      if (text.trim().length > 0) {
        const foreground = segment.cursor ? metrics.theme.background : segment.fg ?? metrics.theme.foreground;
        const textY = y + metrics.fontSize + (metrics.lineHeight - metrics.fontSize) / 2 - metrics.fontSize * 0.08;
        const opacity = segment.dim ? 0.62 : 1;
        parts.push(
          `<text x="${formatNumber(x)}" y="${formatNumber(textY)}" xml:space="preserve" fill="${escapeAttribute(foreground)}" font-family="${escapeAttribute(metrics.fontFamily)}" font-size="${formatNumber(metrics.fontSize)}" font-weight="${segment.bold ? 700 : 500}" font-style="${segment.italic ? "italic" : "normal"}" opacity="${opacity}">${escapeText(text)}</text>`
        );

        if (segment.underline) {
          const underlineY = y + metrics.fontSize + (metrics.lineHeight - metrics.fontSize) / 2 + 2;
          parts.push(
            `<rect x="${formatNumber(x)}" y="${formatNumber(underlineY)}" width="${formatNumber(length * metrics.cellWidth)}" height="${formatNumber(Math.max(1, metrics.fontSize / 12))}" fill="${escapeAttribute(foreground)}" opacity="${opacity}"/>`
          );
        }
      }

      col += length;
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

function createMetrics(frames: RenderedFrame[], options: ExportTerminalGifOptions): TerminalGifMetrics {
  const scale = options.scale ?? 1;
  const baseFontSize = options.fontSize ?? 14;
  const fontSize = baseFontSize * scale;
  const cellWidth = (options.cellWidth ?? Math.ceil(baseFontSize * 0.62)) * scale;
  const lineHeight = (options.lineHeight ?? Math.ceil(baseFontSize * 1.35)) * scale;
  const padding = (options.padding ?? Math.ceil(baseFontSize * 1.2)) * scale;
  const rows = Math.max(...frames.map((frame) => frame.rows));
  const cols = Math.max(...frames.map((frame) => frame.cols));

  return {
    rows,
    cols,
    width: Math.ceil(cols * cellWidth + padding * 2),
    height: Math.ceil(rows * lineHeight + padding * 2),
    fontSize,
    cellWidth,
    lineHeight,
    padding,
    fontFamily: options.fontFamily ?? DEFAULT_FONT_FAMILY,
    theme: {
      background: options.background ?? DEFAULT_BACKGROUND,
      foreground: options.foreground ?? DEFAULT_FOREGROUND,
      cursorColor: options.cursorColor ?? DEFAULT_CURSOR
    }
  };
}

function frameDelay(frames: RenderedFrame[], index: number, options: ExportTerminalGifOptions): number {
  const speed = options.speed ?? 1;
  const minDelay = options.minDelayMs ?? 20;
  const lastDelay = options.lastDelayMs ?? 1000;
  const frame = frames[index];
  const next = frames[index + 1];
  const rawDelay = next ? next.time - frame.time : lastDelay;

  return Math.max(minDelay, Math.round(rawDelay / speed));
}

function defaultOutputPath(tracePath: string): string {
  const parsed = path.parse(tracePath);
  return `${parsed.name || parsed.base}.gif`;
}

function cellLength(text: string): number {
  return Math.max(1, Array.from(text).length);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}
