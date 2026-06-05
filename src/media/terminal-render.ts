import { existsSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { loadResolvedTraceAnnotations } from "../trace/annotations.js";
import { loadTraceInputs } from "../trace/load.js";
import { renderTraceFrames } from "../trace/render.js";
import type { RenderedFrame, ResolvedTraceAnnotation } from "../trace/types.js";

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
  fontFiles?: string[];
  loadSystemFonts?: boolean;
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
  fontFiles: string[];
  loadSystemFonts: boolean;
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
  annotations: ResolvedTraceAnnotation[];
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
  const annotations = await loadResolvedTraceAnnotations(selected.filePath, frames);

  return {
    tracePath: selected.filePath,
    frames,
    annotations,
    metrics: createMetrics(frames, options, renderOptions),
    durationMs: frames.at(-1)?.time ?? 0
  };
}

export function renderTerminalFramePng(frame: RenderedFrame, metrics: TerminalRenderMetrics, annotations: ResolvedTraceAnnotation[] = []): Buffer {
  return renderTerminalFrame(frame, metrics, annotations).asPng();
}

export function renderTerminalFramePixels(frame: RenderedFrame, metrics: TerminalRenderMetrics, annotations: ResolvedTraceAnnotation[] = []): Buffer {
  return renderTerminalFrame(frame, metrics, annotations).pixels;
}

export function renderTerminalFrameRowsPixels(frame: RenderedFrame, metrics: TerminalRenderMetrics, rowStart: number, rowEnd: number): Buffer {
  return renderSvg(terminalFrameRowsToSvg(frame, metrics, rowStart, rowEnd), metrics).pixels;
}

export function renderTerminalFrameSvg(frame: RenderedFrame, metrics: TerminalRenderMetrics, annotations: ResolvedTraceAnnotation[] = []): string {
  return terminalFrameToSvg(frame, metrics, annotations);
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

function renderTerminalFrame(frame: RenderedFrame, metrics: TerminalRenderMetrics, annotations: ResolvedTraceAnnotation[]) {
  const svg = renderTerminalFrameSvg(frame, metrics, annotations);
  return renderSvg(svg, metrics);
}

function renderSvg(svg: string, metrics: TerminalRenderMetrics) {
  return new Resvg(svg, {
    font: {
      loadSystemFonts: metrics.loadSystemFonts,
      fontFiles: metrics.fontFiles,
      defaultFontFamily: metrics.fontFamily,
      defaultFontSize: metrics.fontSize,
      monospaceFamily: metrics.fontFamily
    },
    shapeRendering: 1,
    textRendering: 0,
    background: metrics.theme.background
  }).render();
}

function terminalFrameToSvg(frame: RenderedFrame, metrics: TerminalRenderMetrics, annotations: ResolvedTraceAnnotation[]): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${metrics.width}" height="${metrics.height}" viewBox="0 0 ${metrics.width} ${metrics.height}">`,
    `<rect width="100%" height="100%" fill="${escapeAttribute(metrics.theme.background)}"/>`
  ];

  appendTerminalRows(parts, frame, metrics, 0, metrics.rows, metrics.padding);

  if (metrics.overlay.enabled) {
    parts.push(renderOverlay(frame, metrics, annotations));
  }

  parts.push("</svg>");
  return parts.join("");
}

function terminalFrameRowsToSvg(frame: RenderedFrame, metrics: TerminalRenderMetrics, rowStart: number, rowEnd: number): string {
  const safeStart = Math.max(0, Math.min(rowStart, metrics.rows));
  const safeEnd = Math.max(safeStart, Math.min(rowEnd, metrics.rows));
  const height = Math.ceil((safeEnd - safeStart) * metrics.lineHeight);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${metrics.width}" height="${height}" viewBox="0 0 ${metrics.width} ${height}">`,
    `<rect width="100%" height="100%" fill="${escapeAttribute(metrics.theme.background)}"/>`
  ];

  appendTerminalRows(parts, frame, metrics, safeStart, safeEnd, 0);

  parts.push("</svg>");
  return parts.join("");
}

function appendTerminalRows(
  parts: string[],
  frame: RenderedFrame,
  metrics: TerminalRenderMetrics,
  rowStart: number,
  rowEnd: number,
  yOffset: number
): void {
  for (let row = rowStart; row < rowEnd; row += 1) {
    const segments = frame.lines[row] ?? [{ text: " " }];
    let col = 0;

    for (const segment of segments) {
      const text = segment.text || " ";
      const length = cellLength(text);
      const x = metrics.padding + col * metrics.cellWidth;
      const y = yOffset + (row - rowStart) * metrics.lineHeight;
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
}

function renderOverlay(frame: RenderedFrame, metrics: TerminalRenderMetrics, annotations: ResolvedTraceAnnotation[]): string {
  const rawLines = [`Frame ${frame.index + 1} / ${metrics.frameCount} | ${formatTimestamp(frame.time)}`];
  for (const annotation of annotations.slice(0, 3)) {
    const counts = annotationCounts(annotation);
    rawLines.push(`${annotation.kind ? `${annotation.kind}: ` : ""}${annotation.label}${counts ? ` (${counts})` : ""}`);
  }
  if (annotations.length > 3) {
    rawLines.push(`+${annotations.length - 3} more annotation${annotations.length - 3 === 1 ? "" : "s"}`);
  }

  const fontSize = Math.max(7, metrics.fontSize * 0.78);
  const paddingX = Math.max(5, metrics.fontSize * 0.45);
  const paddingY = Math.max(3, metrics.fontSize * 0.28);
  const margin = Math.max(4, metrics.padding * 0.45);
  const lineGap = Math.max(1, fontSize * 0.26);
  const charWidth = fontSize * 0.62;
  const maxContentWidth = Math.max(1, metrics.width - margin * 2 - paddingX * 2);
  const maxContentHeight = Math.max(1, metrics.height - margin * 2 - paddingY * 2);
  const maxLines = Math.max(1, Math.floor((maxContentHeight + lineGap) / (fontSize + lineGap)));
  const lines = fitOverlayLines(rawLines, maxContentWidth, charWidth, maxLines);
  const contentWidth = Math.min(maxContentWidth, Math.max(...lines.map((line) => line.length * charWidth)));
  const width = contentWidth + paddingX * 2;
  const height = lines.length * fontSize + Math.max(0, lines.length - 1) * lineGap + paddingY * 2;
  const desiredX = metrics.overlay.position.endsWith("right") ? metrics.width - margin - width : margin;
  const desiredY = metrics.overlay.position.startsWith("bottom") ? metrics.height - margin - height : margin;
  const x = clampNumber(desiredX, margin, metrics.width - margin - width);
  const y = clampNumber(desiredY, margin, metrics.height - margin - height);
  const textX = x + paddingX;
  const textY = y + paddingY + fontSize * 0.82;
  const label = lines.join(" | ");

  return [
    `<g aria-label="${escapeAttribute(label)}">`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" rx="${formatNumber(Math.max(4, Math.min(8, fontSize * 0.55)))}" fill="${escapeAttribute(metrics.overlay.background)}" opacity="0.9" stroke="${escapeAttribute(metrics.overlay.foreground)}" stroke-opacity="0.22" stroke-width="1"/>`,
    ...lines.map(
      (line, index) =>
        `<text x="${formatNumber(textX)}" y="${formatNumber(textY + index * (fontSize + lineGap))}" xml:space="preserve" fill="${escapeAttribute(metrics.overlay.foreground)}" font-family="${escapeAttribute(metrics.fontFamily)}" font-size="${formatNumber(fontSize)}" font-weight="${index === 0 ? 700 : 600}">${escapeText(line)}</text>`
    ),
    "</g>"
  ].join("");
}

function fitOverlayLines(rawLines: string[], maxContentWidth: number, charWidth: number, maxLines: number): string[] {
  const maxChars = Math.max(1, Math.floor(maxContentWidth / charWidth));
  const wrapped = rawLines.flatMap((line) => wrapOverlayLine(line, maxChars));
  if (wrapped.length <= maxLines) {
    return wrapped;
  }

  const visible = wrapped.slice(0, maxLines);
  const hidden = wrapped.length - maxLines;
  visible[visible.length - 1] = ellipsizeOverlayLine(`${visible[visible.length - 1]} (+${hidden} more)`, maxChars);
  return visible;
}

function wrapOverlayLine(line: string, maxChars: number): string[] {
  const words = line.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    for (const part of splitOverlayWord(word, maxChars)) {
      if (!current) {
        current = part;
      } else if (current.length + 1 + part.length <= maxChars) {
        current = `${current} ${part}`;
      } else {
        lines.push(current);
        current = part;
      }
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function splitOverlayWord(word: string, maxChars: number): string[] {
  if (word.length <= maxChars) {
    return [word];
  }

  const parts = [];
  for (let index = 0; index < word.length; index += maxChars) {
    parts.push(word.slice(index, index + maxChars));
  }
  return parts;
}

function ellipsizeOverlayLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) {
    return line;
  }

  if (maxChars <= 3) {
    return line.slice(0, maxChars);
  }

  return `${line.slice(0, maxChars - 3)}...`;
}

function annotationCounts(annotation: ResolvedTraceAnnotation): string {
  const parts = [];
  const assertionCount = annotation.assertions.length;
  const attachmentCount =
    annotation.attachments.length + annotation.assertions.reduce((count, assertion) => count + (assertion.attachments?.length ?? 0), 0);
  if (assertionCount > 0) {
    parts.push(`${assertionCount} assert${assertionCount === 1 ? "" : "s"}`);
  }
  if (attachmentCount > 0) {
    parts.push(`${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
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
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontFiles = options.fontFiles?.map((fontFile) => path.resolve(fontFile)) ?? resolveDefaultFontFiles(fontFamily);

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
    fontFamily,
    fontFiles,
    loadSystemFonts: options.loadSystemFonts ?? (fontFiles.length === 0),
    theme: {
      background: options.background ?? DEFAULT_BACKGROUND,
      foreground: options.foreground ?? DEFAULT_FOREGROUND,
      cursorColor: options.cursorColor ?? DEFAULT_CURSOR
    },
    overlay: resolveOverlay(options.overlay)
  };
}

const defaultFontFileCache = new Map<string, string[]>();

function resolveDefaultFontFiles(fontFamily: string): string[] {
  const cached = defaultFontFileCache.get(fontFamily);
  if (cached) {
    return cached;
  }

  const normalized = fontFamily.toLowerCase();
  const groups = [
    {
      names: ["menlo"],
      paths: ["/System/Library/Fonts/Menlo.ttc", "/Library/Fonts/Menlo.ttc"]
    },
    {
      names: ["monaco"],
      paths: ["/System/Library/Fonts/Monaco.ttf", "/System/Library/Fonts/Supplemental/Monaco.ttf"]
    },
    {
      names: ["consolas"],
      paths: ["C:\\Windows\\Fonts\\consola.ttf"]
    },
    {
      names: ["courier", "courier new"],
      paths: [
        "/System/Library/Fonts/Courier.ttc",
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "C:\\Windows\\Fonts\\cour.ttf"
      ]
    },
    {
      names: ["monospace"],
      paths: [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansMono-Regular.ttf"
      ]
    }
  ];

  for (const group of groups) {
    if (!group.names.some((name) => normalized.includes(name))) {
      continue;
    }
    const existing = firstExistingPath(group.paths);
    if (existing) {
      defaultFontFileCache.set(fontFamily, [existing]);
      return [existing];
    }
  }

  const fallback = firstExistingPath(groups.flatMap((group) => group.paths));
  const result = fallback ? [fallback] : [];
  defaultFontFileCache.set(fontFamily, result);
  return result;
}

function firstExistingPath(paths: string[]): string | undefined {
  return paths.find((fontPath) => existsSync(fontPath));
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

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}
