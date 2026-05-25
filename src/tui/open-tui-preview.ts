import {
  createCliRenderer,
  Renderable,
  RGBA,
  TextAttributes,
  type KeyEvent,
  type OptimizedBuffer,
  type RenderableOptions,
  type RenderContext
} from "@opentui/core";
import { createReplayDataSource } from "../preview/data-source.js";
import { annotationsForFrame } from "../preview/selectors.js";
import type { CellSegment, PreviewModel, RenderedFrame, TraceReplay } from "../trace/types.js";

export type OpenTuiPreviewOptions = {
  inputs: string[];
  projectRoot: string;
};

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
const UI_BG = RGBA.fromHex("#f7f6f1");
const UI_TEXT = RGBA.fromHex("#1f252e");
const UI_MUTED = RGBA.fromHex("#69717c");
const UI_PANEL = RGBA.fromHex("#fffdfa");
const UI_BORDER = RGBA.fromHex("#d4d0c6");
const UI_TRACK = RGBA.fromHex("#bdb7ab");
const UI_DARK = RGBA.fromHex("#101318");
const UI_DARK_BORDER = RGBA.fromHex("#252a33");
const UI_RED = RGBA.fromHex("#ff5f57");
const UI_YELLOW = RGBA.fromHex("#ffbd2e");
const UI_TRAFFIC_GREEN = RGBA.fromHex("#28c840");
const UI_ANNOTATION = RGBA.fromHex("#2f7d62");

export async function startOpenTuiPreview(options: OpenTuiPreviewOptions): Promise<void> {
  const dataSource = createReplayDataSource(options);
  const model = await dataSource.load();
  const renderer = await createCliRenderer({
    backgroundColor: UI_BG,
    clearOnShutdown: true,
    consoleMode: "disabled",
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    useMouse: false
  });

  const app = new ReplayAppRenderable(renderer, {
    id: "tui-replay-app",
    width: "100%",
    height: "100%",
    model
  });

  renderer.root.add(app);
  renderer.keyInput.on("keypress", (key) => app.handleKey(key));
  renderer.on("resize", () => app.requestRender());
  renderer.start();
  renderer.requestRender();

  await app.finished;
  renderer.destroy();
}

type ReplayAppOptions = RenderableOptions<ReplayAppRenderable> & {
  model: PreviewModel;
};

class ReplayAppRenderable extends Renderable {
  private readonly model: PreviewModel;
  private traceIndex = 0;
  private frameIndex = 0;
  private speedIndex = 2;
  private playing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resolveFinished: (() => void) | undefined;
  readonly finished = new Promise<void>((resolve) => {
    this.resolveFinished = resolve;
  });

  constructor(ctx: RenderContext, options: ReplayAppOptions) {
    super(ctx, options);
    this.model = options.model;
  }

  handleKey(key: KeyEvent): void {
    const name = key.name.toLowerCase();
    const sequence = key.sequence || key.raw;

    if ((key.ctrl && name === "c") || name === "escape" || name === "q") {
      this.quit();
      return;
    }

    if (name === "space" || sequence === " ") {
      this.togglePlayback();
      return;
    }

    if (name === "right" || sequence === "l") {
      this.stopPlayback();
      this.setFrame(this.frameIndex + 1);
      return;
    }

    if (name === "left" || sequence === "h") {
      this.stopPlayback();
      this.setFrame(this.frameIndex - 1);
      return;
    }

    if (name === "home" || sequence === "0") {
      this.stopPlayback();
      this.setFrame(0);
      return;
    }

    if (name === "end" || sequence === "$") {
      this.stopPlayback();
      this.setFrame(this.currentTrace().frames.length - 1);
      return;
    }

    if (name === "up" || sequence === "]" || sequence === "+") {
      this.speedIndex = clamp(this.speedIndex + 1, 0, SPEEDS.length - 1);
      this.reschedulePlayback();
      this.requestRender();
      return;
    }

    if (name === "down" || sequence === "[" || sequence === "-") {
      this.speedIndex = clamp(this.speedIndex - 1, 0, SPEEDS.length - 1);
      this.reschedulePlayback();
      this.requestRender();
      return;
    }

    if (sequence === "}" || sequence === ".") {
      this.stopPlayback();
      this.setTrace(this.traceIndex + 1);
      return;
    }

    if (sequence === "{" || sequence === ",") {
      this.stopPlayback();
      this.setTrace(this.traceIndex - 1);
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const bounds = {
      x: this.screenX,
      y: this.screenY,
      width: this.width,
      height: this.height
    };
    buffer.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, UI_BG);

    const trace = this.currentTrace();
    const frame = trace.frames[this.frameIndex];
    this.renderTopbar(buffer, bounds, trace);
    this.renderTerminal(buffer, bounds, frame);
    this.renderEventRail(buffer, bounds, trace, frame);
    this.renderEventWindow(buffer, bounds, trace);
    this.renderDetails(buffer, bounds, trace);
  }

  private renderTopbar(buffer: OptimizedBuffer, bounds: Bounds, trace: TraceReplay): void {
    const width = Math.max(30, bounds.width - 2);
    const x = bounds.x + 1;
    const y = bounds.y;
    const frame = trace.frames[this.frameIndex];
    const playState = this.playing ? "playing" : "paused";
    const playIcon = this.playing ? "pause" : "play";
    const status = `[space ${playIcon}] [speed ↑/↓ ${SPEEDS[this.speedIndex]}x] [frame ←/→ ${this.frameIndex + 1}/${trace.frames.length}] [jump home/end] [trace ./,] [q quit]`;
    const traceLabel = truncate(trace.summary.testTitle, Math.max(12, Math.min(34, width - 22)));
    const title = `TUI Replay  ${trace.summary.frameCount} events  ${trace.summary.cols}x${trace.summary.rows}`;
    const time = `${playState} ${formatDuration(frame.time)}`;

    buffer.drawBox({
      x,
      y,
      width,
      height: 4,
      border: true,
      borderColor: UI_BORDER,
      backgroundColor: UI_PANEL,
      borderStyle: "single",
      shouldFill: true
    });

    buffer.drawText("●", x + 2, y + 1, UI_RED, UI_PANEL);
    buffer.drawText("●", x + 4, y + 1, UI_YELLOW, UI_PANEL);
    buffer.drawText("●", x + 6, y + 1, UI_TRAFFIC_GREEN, UI_PANEL);
    buffer.drawText(truncate(title, Math.max(0, width - 10 - traceLabel.length - 2)), x + 9, y + 1, UI_TEXT, UI_PANEL, TextAttributes.BOLD);
    buffer.drawText(traceLabel, x + width - traceLabel.length - 2, y + 1, UI_MUTED, UI_PANEL);

    buffer.drawText(truncate(status, Math.max(0, width - time.length - 5)), x + 2, y + 2, UI_TEXT, UI_PANEL, TextAttributes.BOLD);
    buffer.drawText(time, x + width - time.length - 2, y + 2, this.playing ? UI_ANNOTATION : UI_MUTED, UI_PANEL, TextAttributes.BOLD);
  }

  private renderTerminal(buffer: OptimizedBuffer, bounds: Bounds, frame: RenderedFrame): void {
    const topReserve = 5;
    const bottomReserve = 11;
    const maxContentWidth = Math.max(10, bounds.width - 10);
    const maxContentHeight = Math.max(4, bounds.height - topReserve - bottomReserve);
    const contentWidth = Math.min(frame.cols, maxContentWidth);
    const contentHeight = Math.min(frame.rows, maxContentHeight);
    const boxWidth = contentWidth + 4;
    const boxHeight = contentHeight + 2;
    const x = bounds.x + Math.max(2, Math.floor((bounds.width - boxWidth) / 2));
    const availableTop = bounds.y + topReserve;
    const availableHeight = Math.max(1, bounds.height - topReserve - bottomReserve);
    const y = availableTop + Math.max(0, Math.floor((availableHeight - boxHeight) / 2));

    buffer.drawBox({
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      border: true,
      borderColor: UI_DARK_BORDER,
      backgroundColor: UI_DARK,
      borderStyle: "single",
      shouldFill: true
    });

    for (let row = 0; row < contentHeight; row += 1) {
      drawSegments(buffer, x + 2, y + 1 + row, frame.lines[row] ?? [{ text: " " }], contentWidth);
    }
  }

  private renderEventRail(buffer: OptimizedBuffer, bounds: Bounds, trace: TraceReplay, frame: RenderedFrame): void {
    const x = bounds.x + 2;
    const y = Math.max(bounds.y + 5, bounds.y + bounds.height - 10);
    const width = Math.max(18, bounds.width - 4);
    const label = "all events";
    const status = `${this.frameIndex + 1}/${trace.frames.length} ${formatDuration(frame.time)}`;
    const railX = x + label.length + 2;
    const railWidth = Math.max(8, width - label.length - status.length - 5);
    const rail = Array.from({ length: railWidth }, () => "─");

    trace.frames.forEach((eventFrame) => {
      const position = railPosition(eventFrame.index, trace.frames.length, railWidth);
      rail[position] = annotationsForFrame(trace, eventFrame.index).length > 0 ? "◆" : "┬";
    });

    rail[railPosition(this.frameIndex, trace.frames.length, railWidth)] = this.playing ? "▶" : "●";

    buffer.drawText(label, x, y, UI_MUTED, UI_BG, TextAttributes.BOLD);
    buffer.drawText(rail.join(""), railX, y, UI_TRACK, UI_BG);
    buffer.drawText(status, x + width - status.length, y, UI_TEXT, UI_BG, TextAttributes.BOLD);

    const window = this.visibleEventWindow(bounds);
    const range = `window ${window.start + 1}-${window.start + window.count}/${trace.frames.length}`;
    const scrollX = x + range.length + 2;
    const scrollWidth = Math.max(4, width - range.length - 2);
    const scroll = Array.from({ length: scrollWidth }, () => "·");
    const handle = scrollHandle(trace.frames.length, window.start, window.count, scrollWidth);
    for (let index = handle.start; index < handle.start + handle.width; index += 1) {
      scroll[index] = "━";
    }
    buffer.drawText(range, x, y + 1, UI_MUTED, UI_BG);
    buffer.drawText(scroll.join(""), scrollX, y + 1, UI_MUTED, UI_BG);
  }

  private renderEventWindow(buffer: OptimizedBuffer, bounds: Bounds, trace: TraceReplay): void {
    const y = Math.max(bounds.y + 7, bounds.y + bounds.height - 7);
    const thumbWidth = 10;
    const gap = 1;
    const window = this.visibleEventWindow(bounds, thumbWidth, gap);
    const frames = trace.frames.slice(window.start, window.start + window.count);
    const count = frames.length;
    const totalWidth = count * thumbWidth + Math.max(0, count - 1) * gap;
    let x = bounds.x + Math.max(2, Math.floor((bounds.width - totalWidth) / 2));

    if (window.start > 0) {
      buffer.drawText("◀", Math.max(bounds.x, x - 2), y + 2, UI_MUTED, UI_BG, TextAttributes.BOLD);
    }
    if (window.start + window.count < trace.frames.length) {
      buffer.drawText("▶", Math.min(bounds.x + bounds.width - 1, x + totalWidth + 1), y + 2, UI_MUTED, UI_BG, TextAttributes.BOLD);
    }

    for (let i = 0; i < count; i += 1) {
      const frame = frames[i];
      const active = frame.index === this.frameIndex;
      const frameAnnotations = annotationsForFrame(trace, frame.index);
      buffer.drawBox({
        x,
        y,
        width: thumbWidth,
        height: 5,
        border: true,
        borderColor: active ? UI_TEXT : frameAnnotations.length > 0 ? UI_ANNOTATION : UI_BORDER,
        backgroundColor: UI_PANEL,
        borderStyle: "single",
        shouldFill: true
      });
      buffer.drawText(truncate(`${frame.index + 1} | ${formatDuration(frame.time)}`, thumbWidth - 2), x + 1, y + 1, active ? UI_TEXT : UI_MUTED, UI_PANEL);
      const annotation = frameAnnotations[0];
      const lines = frame.plainText.split("\n").filter(Boolean);
      if (annotation) {
        buffer.drawText(truncate(annotation.label, thumbWidth - 2), x + 1, y + 2, UI_ANNOTATION, UI_PANEL);
        buffer.drawText(truncate(lines[0] ?? "", thumbWidth - 2), x + 1, y + 3, UI_TEXT, UI_PANEL);
      } else {
        buffer.drawText(truncate(lines[0] ?? "", thumbWidth - 2), x + 1, y + 2, UI_TEXT, UI_PANEL);
        buffer.drawText(truncate(lines[1] ?? "", thumbWidth - 2), x + 1, y + 3, UI_TEXT, UI_PANEL);
      }
      x += thumbWidth + gap;
    }
  }

  private renderDetails(buffer: OptimizedBuffer, bounds: Bounds, trace: TraceReplay): void {
    if (bounds.height < 18) {
      return;
    }

    const x = bounds.x + 2;
    const traceY = bounds.y + bounds.height - 2;
    const detailY = bounds.y + bounds.height - 1;
    const width = Math.max(10, bounds.width - 4);
    const expectation = trace.details.expectations[0];
    const annotation = annotationsForFrame(trace, this.frameIndex)[0];
    const left = `Trace: ${trace.summary.filePath}`;
    const right = trace.summary.attempt != null ? `Attempt: ${trace.summary.attempt}` : "";
    buffer.drawText(truncate(left, Math.max(0, width - right.length - 2)), x, traceY, UI_TEXT, UI_BG, TextAttributes.BOLD);
    if (right) {
      buffer.drawText(right, x + width - right.length, traceY, UI_TEXT, UI_BG, TextAttributes.BOLD);
    }

    const detail = annotation
      ? `${formatDuration(annotation.timeMs)} ${annotation.label}${annotation.description ? ` - ${annotation.description}` : ""}`
      : expectation
        ? `${expectation.line}: ${expectation.snippet}`
        : "No test expectations found for this trace.";
    buffer.drawText(truncate(detail, width), x, detailY, annotation ? UI_ANNOTATION : expectation ? UI_TEXT : UI_MUTED, UI_BG);
  }

  private togglePlayback(): void {
    if (this.playing) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
    this.requestRender();
  }

  private startPlayback(): void {
    if (this.playing) {
      return;
    }

    const trace = this.currentTrace();
    if (this.frameIndex >= trace.frames.length - 1) {
      this.frameIndex = 0;
    }

    this.playing = true;
    this.scheduleNextFrame();
  }

  private stopPlayback(): void {
    this.playing = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private reschedulePlayback(): void {
    if (!this.playing) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.scheduleNextFrame();
  }

  private scheduleNextFrame(): void {
    const trace = this.currentTrace();
    const current = trace.frames[this.frameIndex];
    const next = trace.frames[this.frameIndex + 1];

    if (!this.playing || !current || !next) {
      this.stopPlayback();
      this.requestRender();
      return;
    }

    const delay = Math.max(16, (next.time - current.time) / SPEEDS[this.speedIndex]);
    this.timer = setTimeout(() => {
      this.frameIndex += 1;
      this.requestRender();
      this.scheduleNextFrame();
    }, delay);
  }

  private setFrame(index: number): void {
    this.frameIndex = clamp(index, 0, this.currentTrace().frames.length - 1);
    this.requestRender();
  }

  private setTrace(index: number): void {
    this.traceIndex = clamp(index, 0, this.model.traces.length - 1);
    this.frameIndex = 0;
    this.requestRender();
  }

  private currentTrace(): TraceReplay {
    return this.model.traces[this.traceIndex];
  }

  private visibleEventWindow(bounds: Bounds, thumbWidth = 10, gap = 1): { start: number; count: number } {
    const trace = this.currentTrace();
    const count = Math.max(1, Math.min(trace.frames.length, Math.floor((bounds.width - 8 + gap) / (thumbWidth + gap))));
    const start = clamp(this.frameIndex - Math.floor(count / 2), 0, Math.max(0, trace.frames.length - count));
    return { start, count };
  }

  private quit(): void {
    this.stopPlayback();
    this.resolveFinished?.();
  }
}

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function drawSegments(buffer: OptimizedBuffer, x: number, y: number, segments: CellSegment[], maxWidth: number): void {
  let cursor = 0;

  for (const segment of segments) {
    if (cursor >= maxWidth) {
      return;
    }

    const text = segment.text.slice(0, maxWidth - cursor);
    if (text.length === 0) {
      continue;
    }

    const fg = color(segment.cursor ? "#101318" : segment.fg ?? "#d4d4d8");
    const bg = color(segment.cursor ? "#f8fafc" : segment.bg ?? "#101318");
    buffer.drawText(text, x + cursor, y, fg, bg, attributes(segment));
    cursor += text.length;
  }
}

function attributes(segment: CellSegment): number {
  let value = TextAttributes.NONE;
  if (segment.bold) value |= TextAttributes.BOLD;
  if (segment.dim) value |= TextAttributes.DIM;
  if (segment.italic) value |= TextAttributes.ITALIC;
  if (segment.underline) value |= TextAttributes.UNDERLINE;
  if (segment.inverse) value |= TextAttributes.INVERSE;
  return value;
}

function color(value: string): RGBA {
  return RGBA.fromHex(value);
}

function railPosition(index: number, total: number, width: number): number {
  if (total <= 1 || width <= 1) {
    return 0;
  }
  return clamp(Math.round((index / (total - 1)) * (width - 1)), 0, width - 1);
}

function scrollHandle(total: number, start: number, count: number, width: number): { start: number; width: number } {
  if (total <= count || width <= 1) {
    return { start: 0, width };
  }

  const handleWidth = Math.max(1, Math.round((count / total) * width));
  const maxStart = Math.max(1, total - count);
  const handleStart = clamp(Math.round((start / maxStart) * (width - handleWidth)), 0, width - handleWidth);
  return { start: handleStart, width: handleWidth };
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength === 1) {
    return "…";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
