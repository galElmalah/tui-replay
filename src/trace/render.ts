import { createRequire } from "node:module";
import type { ITerminalInitOnlyOptions, ITerminalOptions, Terminal as HeadlessTerminal } from "@xterm/headless";
import type { CellSegment, CellStyle, DataTracePoint, RenderedFrame, SizeTracePoint, TracePoint, TuiTrace } from "./types.js";

const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 80;
const DEFAULT_FG = "#d4d4d8";
const DEFAULT_BG = "#101318";
const XTERM_PALETTE = buildXtermPalette();
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as {
  Terminal: new (options?: ITerminalOptions & ITerminalInitOnlyOptions) => HeadlessTerminal;
};

type BufferLine = NonNullable<ReturnType<HeadlessTerminal["buffer"]["active"]["getLine"]>>;
type BufferCell = NonNullable<ReturnType<BufferLine["getCell"]>>;

export async function renderTraceFrames(trace: TuiTrace): Promise<RenderedFrame[]> {
  const firstSize = trace.tracePoints.find(isSizeTracePoint);
  const firstData = trace.tracePoints.find(isDataTracePoint);
  const startTime = firstData?.time ?? 0;
  const rows = firstSize?.rows ?? DEFAULT_ROWS;
  const cols = firstSize?.cols ?? DEFAULT_COLS;
  const terminal = new Terminal({
    rows,
    cols,
    allowProposedApi: true,
    scrollback: 1000,
    windowsMode: false
  });
  const frames: RenderedFrame[] = [captureFrame(terminal, 0, -1, 0)];

  for (const [eventIndex, point] of trace.tracePoints.entries()) {
    if (isSizeTracePoint(point)) {
      terminal.resize(point.cols, point.rows);
      if (eventIndex !== trace.tracePoints.findIndex(isSizeTracePoint)) {
        frames.push(captureFrame(terminal, frames.length, eventIndex, currentTraceTime(trace.tracePoints, eventIndex, startTime)));
      }
      continue;
    }

    if (point.data.length === 0) {
      continue;
    }

    await writeToTerminal(terminal, point.data);
    frames.push(captureFrame(terminal, frames.length, eventIndex, point.time - startTime));
  }

  return frames;
}

function captureFrame(terminal: HeadlessTerminal, index: number, eventIndex: number, time: number): RenderedFrame {
  const buffer = terminal.buffer.active;
  const lines: CellSegment[][] = [];
  const plainLines: string[] = [];
  const cursorX = buffer.cursorX;
  const cursorY = buffer.cursorY;

  for (let y = 0; y < terminal.rows; y += 1) {
    const line = buffer.getLine(buffer.baseY + y);
    const segments: CellSegment[] = [];
    const plainCells: string[] = [];
    let pending: CellSegment | undefined;

    for (let x = 0; x < terminal.cols; x += 1) {
      const cell = line?.getCell(x);
      if (cell?.getWidth() === 0) {
        continue;
      }

      const text = normalizeCellText(cell?.getChars());
      const style = cellStyle(cell, x === cursorX && y === cursorY);
      plainCells.push(text);

      if (pending && sameStyle(pending, style)) {
        pending.text += text;
      } else {
        if (pending) {
          segments.push(pending);
        }
        pending = { text, ...style };
      }
    }

    if (pending) {
      segments.push(pending);
    }

    lines.push(trimTrailingEmptySegments(segments));
    plainLines.push(plainCells.join("").trimEnd());
  }

  return {
    index,
    eventIndex,
    time: Math.max(0, time),
    rows: terminal.rows,
    cols: terminal.cols,
    lines,
    plainText: plainLines.join("\n").trimEnd()
  };
}

function writeToTerminal(terminal: HeadlessTerminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}

function currentTraceTime(points: TracePoint[], eventIndex: number, startTime: number): number {
  for (let i = eventIndex; i >= 0; i -= 1) {
    const point = points[i];
    if (isDataTracePoint(point)) {
      return point.time - startTime;
    }
  }
  return 0;
}

function normalizeCellText(chars: string | undefined): string {
  return chars && chars.length > 0 ? chars : " ";
}

function cellStyle(cell: BufferCell | undefined, cursor: boolean): CellStyle {
  if (!cell) {
    return cursor ? { cursor } : {};
  }

  let fg = foregroundToCss(cell);
  let bg = backgroundToCss(cell);

  if (cell.isInverse()) {
    const inverseFg = bg ?? DEFAULT_BG;
    const inverseBg = fg ?? DEFAULT_FG;
    fg = inverseFg;
    bg = inverseBg;
  }

  return withoutFalse({
    fg,
    bg,
    bold: Boolean(cell.isBold()),
    dim: Boolean(cell.isDim()),
    italic: Boolean(cell.isItalic()),
    underline: Boolean(cell.isUnderline()),
    inverse: Boolean(cell.isInverse()),
    cursor
  });
}

function foregroundToCss(cell: BufferCell): string | undefined {
  if (cell.isFgDefault()) {
    return undefined;
  }

  if (cell.isFgPalette()) {
    return XTERM_PALETTE[cell.getFgColor()] ?? undefined;
  }

  if (cell.isFgRGB()) {
    return rgbIntToHex(cell.getFgColor());
  }

  return undefined;
}

function backgroundToCss(cell: BufferCell): string | undefined {
  if (cell.isBgDefault()) {
    return undefined;
  }

  if (cell.isBgPalette()) {
    return XTERM_PALETTE[cell.getBgColor()] ?? undefined;
  }

  if (cell.isBgRGB()) {
    return rgbIntToHex(cell.getBgColor());
  }

  return undefined;
}

function rgbIntToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0").slice(-6)}`;
}

function sameStyle(segment: CellSegment, style: CellStyle): boolean {
  return (
    segment.fg === style.fg &&
    segment.bg === style.bg &&
    segment.bold === style.bold &&
    segment.dim === style.dim &&
    segment.italic === style.italic &&
    segment.underline === style.underline &&
    segment.inverse === style.inverse &&
    segment.cursor === style.cursor
  );
}

function trimTrailingEmptySegments(segments: CellSegment[]): CellSegment[] {
  const trimmed = [...segments];

  while (trimmed.length > 0) {
    const last = trimmed.at(-1);
    if (!last || last.text.trimEnd().length > 0 || last.bg || last.cursor) {
      break;
    }
    trimmed.pop();
  }

  if (trimmed.length === 0) {
    return [{ text: " " }];
  }

  const last = trimmed.at(-1);
  if (last) {
    last.text = last.text.trimEnd() || " ";
  }

  return trimmed;
}

function withoutFalse(style: CellStyle): CellStyle {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== false && value !== undefined)) as CellStyle;
}

function isDataTracePoint(point: TracePoint): point is DataTracePoint {
  return "time" in point;
}

function isSizeTracePoint(point: TracePoint): point is SizeTracePoint {
  return "rows" in point && "cols" in point;
}

function buildXtermPalette(): string[] {
  const palette = [
    "#000000",
    "#cd0000",
    "#00cd00",
    "#cdcd00",
    "#0000ee",
    "#cd00cd",
    "#00cdcd",
    "#e5e5e5",
    "#7f7f7f",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#5c5cff",
    "#ff00ff",
    "#00ffff",
    "#ffffff"
  ];
  const levels = [0, 95, 135, 175, 215, 255];

  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        palette.push(rgbToHex(r, g, b));
      }
    }
  }

  for (let i = 0; i < 24; i += 1) {
    const level = 8 + i * 10;
    palette.push(rgbToHex(level, level, level));
  }

  return palette;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
