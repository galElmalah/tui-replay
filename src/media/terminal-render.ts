import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { loadTraceInputs } from "../trace/load.js";
import { renderTraceFrames } from "../trace/render.js";
import type { RenderedFrame } from "../trace/types.js";

const DEFAULT_BACKGROUND = "#101318";
const DEFAULT_FOREGROUND = "#e4e7eb";
const DEFAULT_CURSOR = "#f8fafc";
const DEFAULT_FONT_FAMILY = "Menlo, Monaco, Consolas, monospace";
const DEFAULT_OVERLAY_BACKGROUND = "#05080c";
const DEFAULT_OVERLAY_FOREGROUND = "#f8fafc";

export type TerminalOverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type TerminalOverlayOptions = {
  enabled?: boolean;
  position?: TerminalOverlayPosition;
  background?: string;
  foreground?: string;
};

export type TerminalRenderOptions = {
  input: string | string[];
  traceIndex?: number;
  speed?: number;
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
  overlay?: boolean | TerminalOverlayOptions;
};

export type TerminalRenderMetrics = {
  rows: number;
  cols: number;
  frameCount: number;
  width: number;
  height: number;
  fontSize: number;
  cellWidth: number;
  lineHeight: number;
  padding: number;
  fontFamily: string;
  theme: {
    background: string;
    foreground: string;
    cursorColor: string;
  };
  overlay: {
    enabled: boolean;
    position: TerminalOverlayPosition;
    background: string;
    foreground: string;
  };
};

export type TerminalRenderSource = {
  tracePath: string;
  frames: RenderedFrame[];
  metrics: TerminalRenderMetrics;
  durationMs: number;
};

export async function loadTerminalRenderSource(
  options: TerminalRenderOptions,
  renderOptions: { evenDimensions?: boolean } = {}
): Promise<TerminalRenderSource> {
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

  return {
    tracePath: selected.filePath,
    frames,
    metrics: createMetrics(frames, options, renderOptions),
    durationMs: frames.at(-1)?.time ?? 0
  };
}

export function renderTerminalFramePng(frame: RenderedFrame, metrics: TerminalRenderMetrics): Buffer {
  return renderTerminalFrame(frame, metrics).asPng();
}

export function renderTerminalFramePixels(frame: RenderedFrame, metrics: TerminalRenderMetrics): Buffer {
  return renderTerminalFrame(frame, metrics).pixels;
}

export function terminalFrameDelay(frames: RenderedFrame[], index: number, options: TerminalRenderOptions): number {
  const speed = options.speed ?? 1;
  const minDelay = options.minDelayMs ?? 20;
  const lastDelay = options.lastDelayMs ?? 1000;
  const frame = frames[index];
  const next = frames[index + 1];
  const rawDelay = next ? next.time - frame.time : lastDelay;

  return Math.max(minDelay, Math.round(rawDelay / speed));
}

export function defaultTerminalOutputPath(tracePath: string, extension: string): string {
  const parsed = path.parse(tracePath);
  return `${parsed.name || parsed.base}.${extension}`;
}

function renderTerminalFrame(frame: RenderedFrame, metrics: TerminalRenderMetrics) {
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
  }).render();
}

function terminalFrameToSvg(frame: RenderedFrame, metrics: TerminalRenderMetrics): string {
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

  if (metrics.overlay.enabled) {
    parts.push(renderOverlay(frame, metrics));
  }

  parts.push("</svg>");
  return parts.join("");
}

function renderOverlay(frame: RenderedFrame, metrics: TerminalRenderMetrics): string {
  const label = `Frame ${frame.index + 1} / ${metrics.frameCount} | ${formatTimestamp(frame.time)}`;
  const fontSize = Math.max(7, metrics.fontSize * 0.78);
  const paddingX = Math.max(5, metrics.fontSize * 0.45);
  const paddingY = Math.max(3, metrics.fontSize * 0.28);
  const margin = Math.max(4, metrics.padding * 0.45);
  const width = Math.min(metrics.width - margin * 2, label.length * fontSize * 0.62 + paddingX * 2);
  const height = fontSize + paddingY * 2;
  const x = metrics.overlay.position.endsWith("right") ? metrics.width - margin - width : margin;
  const y = metrics.overlay.position.startsWith("bottom") ? metrics.height - margin - height : margin;
  const textX = x + paddingX;
  const textY = y + paddingY + fontSize * 0.82;

  return [
    `<g aria-label="${escapeAttribute(label)}">`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" rx="${formatNumber(Math.max(4, height / 3))}" fill="${escapeAttribute(metrics.overlay.background)}" opacity="0.82"/>`,
    `<text x="${formatNumber(textX)}" y="${formatNumber(textY)}" xml:space="preserve" fill="${escapeAttribute(metrics.overlay.foreground)}" font-family="${escapeAttribute(metrics.fontFamily)}" font-size="${formatNumber(fontSize)}" font-weight="700">${escapeText(label)}</text>`,
    "</g>"
  ].join("");
}

function createMetrics(
  frames: RenderedFrame[],
  options: TerminalRenderOptions,
  renderOptions: { evenDimensions?: boolean }
): TerminalRenderMetrics {
  const scale = options.scale ?? 1;
  const baseFontSize = options.fontSize ?? 14;
  const fontSize = baseFontSize * scale;
  const cellWidth = (options.cellWidth ?? Math.ceil(baseFontSize * 0.62)) * scale;
  const lineHeight = (options.lineHeight ?? Math.ceil(baseFontSize * 1.35)) * scale;
  const padding = (options.padding ?? Math.ceil(baseFontSize * 1.2)) * scale;
  const rows = Math.max(...frames.map((frame) => frame.rows));
  const cols = Math.max(...frames.map((frame) => frame.cols));
  const width = Math.ceil(cols * cellWidth + padding * 2);
  const height = Math.ceil(rows * lineHeight + padding * 2);

  return {
    rows,
    cols,
    frameCount: frames.length,
    width: renderOptions.evenDimensions ? makeEven(width) : width,
    height: renderOptions.evenDimensions ? makeEven(height) : height,
    fontSize,
    cellWidth,
    lineHeight,
    padding,
    fontFamily: options.fontFamily ?? DEFAULT_FONT_FAMILY,
    theme: {
      background: options.background ?? DEFAULT_BACKGROUND,
      foreground: options.foreground ?? DEFAULT_FOREGROUND,
      cursorColor: options.cursorColor ?? DEFAULT_CURSOR
    },
    overlay: resolveOverlay(options.overlay)
  };
}

function resolveOverlay(overlay: TerminalRenderOptions["overlay"]): TerminalRenderMetrics["overlay"] {
  if (overlay === true) {
    return {
      enabled: true,
      position: "bottom-right",
      background: DEFAULT_OVERLAY_BACKGROUND,
      foreground: DEFAULT_OVERLAY_FOREGROUND
    };
  }

  if (!overlay) {
    return {
      enabled: false,
      position: "bottom-right",
      background: DEFAULT_OVERLAY_BACKGROUND,
      foreground: DEFAULT_OVERLAY_FOREGROUND
    };
  }

  return {
    enabled: overlay.enabled ?? true,
    position: overlay.position ?? "bottom-right",
    background: overlay.background ?? DEFAULT_OVERLAY_BACKGROUND,
    foreground: overlay.foreground ?? DEFAULT_OVERLAY_FOREGROUND
  };
}

function formatTimestamp(timeMs: number): string {
  if (timeMs < 1000) {
    return `${Math.round(timeMs)}ms`;
  }
  return `${(timeMs / 1000).toFixed(2)}s`;
}

function cellLength(text: string): number {
  return Math.max(1, Array.from(text).length);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function makeEven(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}
