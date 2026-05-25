import { annotationsForFrame, frameIndexAtTime, timelineFrames } from "../preview/selectors.js";
import type { CellSegment, PreviewModel, RenderedFrame, ResolvedTraceAnnotation, SourceDetails, TraceReplay } from "../trace/types.js";

type State = {
  model: PreviewModel | undefined;
  modelSignature: string | undefined;
  traceIndex: number;
  frameIndex: number;
  followTail: boolean;
  speed: number;
  playing: boolean;
  animationFrame: number | undefined;
  playbackAnchorRealTime: number;
  playbackAnchorTraceTime: number;
};

const state: State = {
  model: undefined,
  modelSignature: undefined,
  traceIndex: 0,
  frameIndex: 0,
  followTail: true,
  speed: 1,
  playing: false,
  animationFrame: undefined,
  playbackAnchorRealTime: 0,
  playbackAnchorTraceTime: 0
};
let pageScrollBeforeInteraction: { left: number; top: number } | undefined;
let pollingModel = false;

const stage = requiredElement<HTMLElement>("stage");
const terminalWindow = requiredElement<HTMLDivElement>("terminal-window");
const terminal = requiredElement<HTMLDivElement>("terminal");
const traceMeta = requiredElement<HTMLParagraphElement>("trace-meta");
const tracePicker = requiredElement<HTMLDivElement>("trace-picker");
const traceTrigger = requiredElement<HTMLButtonElement>("trace-trigger");
const traceTriggerLabel = requiredElement<HTMLSpanElement>("trace-trigger-label");
const traceMenu = requiredElement<HTMLDivElement>("trace-menu");
const previousFrame = requiredElement<HTMLButtonElement>("previous-frame");
const playToggle = requiredElement<HTMLButtonElement>("play-toggle");
const nextFrame = requiredElement<HTMLButtonElement>("next-frame");
const frameRange = requiredElement<HTMLInputElement>("frame-range");
const frameProgress = requiredElement<HTMLDivElement>("frame-progress");
const frameNotches = requiredElement<HTMLDivElement>("frame-notches");
const speedSelect = requiredElement<HTMLSelectElement>("speed-select");
const frameCounter = requiredElement<HTMLOutputElement>("frame-counter");
const timeline = requiredElement<HTMLDivElement>("timeline");
const details = requiredElement<HTMLElement>("details");

void init();

async function init(): Promise<void> {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  window.scrollTo(0, 0);
  state.model = await fetchPreviewModel();
  state.modelSignature = modelSignature(state.model);
  renderTraceOptions();
  render();
  bindEvents();
  connectLiveUpdates();
}

function bindEvents(): void {
  [traceTrigger, previousFrame, playToggle, nextFrame, frameRange, speedSelect].forEach((control) => {
    control.addEventListener("pointerdown", rememberPageScroll);
    control.addEventListener("keydown", rememberPageScroll);
  });

  traceTrigger.addEventListener("click", () => {
    setTraceMenuOpen(traceMenu.hidden);
    restorePageScroll();
  });

  traceTrigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setTraceMenuOpen(true);
      traceMenu.querySelector<HTMLButtonElement>(".trace-option.active")?.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!tracePicker.contains(event.target as Node)) {
      setTraceMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setTraceMenuOpen(false);
      traceTrigger.focus();
    }
  });

  previousFrame.addEventListener("click", () => {
    stopPlayback();
    setFrame(state.frameIndex - 1);
  });

  nextFrame.addEventListener("click", () => {
    stopPlayback();
    setFrame(state.frameIndex + 1);
  });

  playToggle.addEventListener("click", () => {
    if (state.playing) {
      stopPlayback();
      renderControls(currentTrace());
    } else {
      startPlayback();
    }
    restorePageScroll();
  });

  frameRange.addEventListener("input", () => {
    stopPlayback();
    setFrame(Number(frameRange.value));
  });

  speedSelect.addEventListener("change", () => {
    const now = performance.now();
    const traceTime = state.playing ? currentPlaybackTraceTime(now) : undefined;
    state.speed = Number(speedSelect.value);
    if (state.playing && traceTime != null) {
      anchorPlayback(traceTime, now);
      const trace = currentTrace();
      if (trace) {
        renderPlaybackAt(trace, traceTime);
      }
    }
  });

  window.addEventListener("resize", () => {
    const trace = currentTrace();
    if (trace) {
      renderTerminal(trace.frames[state.frameIndex]);
    }
  });
}

function render(): void {
  const trace = currentTrace();
  if (!trace) {
    terminal.textContent = "No traces loaded.";
    return;
  }

  state.frameIndex = clamp(state.frameIndex, 0, trace.frames.length - 1);
  renderTraceMeta(trace);
  renderTerminal(trace.frames[state.frameIndex]);
  renderControls(trace);
  renderFrameNotches(trace);
  renderTimeline(trace);
  renderDetails(trace.details, trace);
}

function connectLiveUpdates(): void {
  if (!("EventSource" in window)) {
    startPollingLiveUpdates();
    return;
  }

  const events = new EventSource("/api/events");
  events.addEventListener("model", (event) => {
    applyModelUpdate(JSON.parse((event as MessageEvent<string>).data) as PreviewModel);
  });
}

function startPollingLiveUpdates(): void {
  window.setInterval(() => {
    if (pollingModel) {
      return;
    }

    pollingModel = true;
    void fetchPreviewModel()
      .then(applyModelUpdate)
      .catch(() => {
        // Keep the last good model while a trace file is mid-write.
      })
      .finally(() => {
        pollingModel = false;
      });
  }, 1000);
}

async function fetchPreviewModel(): Promise<PreviewModel> {
  const response = await fetch("/api/traces");
  if (!response.ok) {
    throw new Error(`Unable to load traces: ${response.status}`);
  }
  return (await response.json()) as PreviewModel;
}

function applyModelUpdate(model: PreviewModel): void {
  const nextSignature = modelSignature(model);
  if (nextSignature === state.modelSignature) {
    return;
  }

  const previousTraces = state.model?.traces ?? [];
  const previousTrace = currentTrace();
  const previousKey = previousTrace ? traceKey(previousTrace) : undefined;
  const previousTime = previousTrace?.frames[state.frameIndex]?.time ?? 0;
  const wasAtEnd = previousTrace ? state.frameIndex >= previousTrace.frames.length - 1 : true;
  const playbackTime = state.playing ? currentPlaybackTraceTime(performance.now()) : previousTime;

  state.model = model;
  state.modelSignature = nextSignature;

  if (previousKey) {
    const nextIndex = model.traces.findIndex((trace) => traceKey(trace) === previousKey);
    state.traceIndex = nextIndex >= 0 ? nextIndex : clamp(state.traceIndex, 0, Math.max(0, model.traces.length - 1));
  } else if (previousTraces.length === 0 && model.traces.length > 0) {
    state.traceIndex = 0;
  }

  const trace = currentTrace();
  if (trace) {
    if (state.playing) {
      const now = performance.now();
      const traceTime = clamp(playbackTime, 0, trace.summary.durationMs);
      state.frameIndex = frameIndexAtTime(trace.frames, traceTime);
      anchorPlayback(traceTime, now);
    } else if (state.followTail || wasAtEnd) {
      state.frameIndex = trace.frames.length - 1;
    } else {
      state.frameIndex = frameIndexAtTime(trace.frames, previousTime);
    }
  }

  renderTraceOptions();
  render();
}

function renderTraceOptions(): void {
  const traces = state.model?.traces ?? [];
  traceMenu.innerHTML = "";
  tracePicker.classList.toggle("single", traces.length <= 1);

  traces.forEach((trace, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `trace-option${index === state.traceIndex ? " active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === state.traceIndex));
    option.textContent = trace.summary.testTitle;
    option.addEventListener("click", () => selectTrace(index));
    traceMenu.append(option);
  });
}

function selectTrace(index: number): void {
  stopPlayback();
  state.traceIndex = index;
  state.frameIndex = 0;
  state.followTail = true;
  setTraceMenuOpen(false);
  render();
  restorePageScroll();
}

function setTraceMenuOpen(open: boolean): void {
  if (open && (state.model?.traces.length ?? 0) <= 1) {
    open = false;
  }
  traceMenu.hidden = !open;
  traceTrigger.setAttribute("aria-expanded", String(open));
}

function renderTraceMeta(trace: TraceReplay): void {
  const summary = trace.summary;
  const source = summary.testFile
    ? `${compactPath(summary.testFile)}${summary.sourceLine ? `:${summary.sourceLine}` : ""}`
    : summary.fileName;
  traceMeta.textContent = `${source} | ${summary.frameCount} frames | ${formatDuration(summary.durationMs)} | ${summary.cols}x${summary.rows}`;
  traceTriggerLabel.textContent = summary.testTitle;
  traceTrigger.title = summary.testTitle;
  traceMenu.querySelectorAll<HTMLButtonElement>(".trace-option").forEach((option, index) => {
    option.classList.toggle("active", index === state.traceIndex);
    option.setAttribute("aria-selected", String(index === state.traceIndex));
  });
}

function renderTerminal(frame: RenderedFrame): void {
  const sizing = terminalLayout(frame);
  terminalWindow.style.setProperty("--cols", String(frame.cols));
  terminalWindow.style.setProperty("--rows", String(frame.rows));
  terminalWindow.style.setProperty("--cell-width", `${sizing.cellWidth}px`);
  terminalWindow.style.setProperty("--line-height", `${sizing.lineHeight}px`);
  terminalWindow.style.setProperty("--font-size", `${sizing.fontSize}px`);
  terminalWindow.style.setProperty("--window-width", `${sizing.windowWidth}px`);
  terminalWindow.style.setProperty("--window-height", `${sizing.windowHeight}px`);
  terminal.style.setProperty("--cols", String(frame.cols));
  terminal.style.setProperty("--rows", String(frame.rows));
  terminal.innerHTML = "";

  const fragment = document.createDocumentFragment();
  frame.lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "terminal-line";

    line.forEach((segment) => {
      const span = document.createElement("span");
      span.textContent = segment.text;
      applyStyle(span, segment);
      row.append(span);
    });

    fragment.append(row);
  });

  terminal.append(fragment);
}

function terminalLayout(frame: RenderedFrame): {
  cellWidth: number;
  lineHeight: number;
  fontSize: number;
  windowWidth: number;
  windowHeight: number;
} {
  const stageBounds = stage.getBoundingClientRect();
  const cellWidth = 10;
  const lineHeight = 20;
  const fontSize = 15;
  const chromeHeight = 32;
  const terminalPaddingX = 32;
  const terminalPaddingY = 32;
  const naturalWidth = frame.cols * cellWidth + terminalPaddingX;
  const naturalHeight = chromeHeight + frame.rows * lineHeight + terminalPaddingY;
  const maxWindowWidth = Math.max(420, stageBounds.width * 0.95);
  const maxWindowHeight = Math.max(320, stageBounds.height * 0.88);
  const preferredWidth = Math.max(naturalWidth, stageBounds.width * 0.84);
  const preferredHeight = Math.max(naturalHeight, stageBounds.height * 0.64);

  return {
    cellWidth,
    lineHeight,
    fontSize,
    windowWidth: roundTo(clamp(preferredWidth, Math.min(naturalWidth, maxWindowWidth), maxWindowWidth), 2),
    windowHeight: roundTo(clamp(preferredHeight, Math.min(naturalHeight, maxWindowHeight), maxWindowHeight), 2)
  };
}

function renderControls(trace: TraceReplay | undefined, traceTime?: number): void {
  const frames = trace?.frames ?? [];
  frameRange.max = String(Math.max(0, frames.length - 1));
  frameRange.value = String(state.frameIndex);
  const displayTime = traceTime ?? frames[state.frameIndex]?.time ?? 0;
  frameCounter.value = frames.length > 0 ? `${state.frameIndex + 1} / ${frames.length} | ${formatDuration(displayTime)}` : "0 / 0";
  playToggle.innerHTML = state.playing ? "&#10074;&#10074;" : "&#9654;";
  playToggle.setAttribute("aria-label", state.playing ? "Pause" : "Play");
  previousFrame.disabled = state.frameIndex <= 0;
  nextFrame.disabled = frames.length === 0 || state.frameIndex >= frames.length - 1;
  syncProgress(trace, traceTime);
}

function renderFrameNotches(trace: TraceReplay): void {
  frameNotches.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const totalDuration = Math.max(1, trace.summary.durationMs);

  trace.frames.forEach((frame) => {
    const notch = document.createElement("span");
    notch.className = `frame-notch${frame.index === state.frameIndex ? " active" : ""}`;
    notch.style.left = `${clamp((frame.time / totalDuration) * 100, 0, 100)}%`;
    notch.title = `Frame ${frame.index + 1} at ${formatDuration(frame.time)}`;
    fragment.append(notch);
  });

  trace.annotations.forEach((annotation) => {
    const marker = document.createElement("span");
    marker.className = "annotation-marker";
    marker.style.left = `${progressForTime(trace, annotation.timeMs)}%`;
    marker.style.backgroundColor = annotation.color ?? colorForAnnotation(annotation);
    marker.title = `${formatDuration(annotation.timeMs)}: ${annotation.label}`;
    fragment.append(marker);
  });

  frameNotches.append(fragment);
}

function renderTimeline(trace: TraceReplay): void {
  timeline.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const frames = timelineFrames(trace.frames, state.frameIndex);

  frames.forEach((frame) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `thumb${frame.index === state.frameIndex ? " active" : ""}`;
    button.setAttribute("aria-label", `Frame ${frame.index + 1}`);
    button.addEventListener("pointerdown", rememberPageScroll);
    button.addEventListener("keydown", rememberPageScroll);
    button.addEventListener("click", () => {
      stopPlayback();
      setFrame(frame.index);
    });

    const time = document.createElement("span");
    time.className = "thumb-time";
    time.textContent = `${frame.index + 1} | ${formatDuration(frame.time)}`;
    button.append(time);

    const frameAnnotations = annotationsForFrame(trace, frame.index);
    if (frameAnnotations.length > 0) {
      button.classList.add("annotated");
      const annotation = document.createElement("span");
      annotation.className = "thumb-annotation";
      annotation.textContent = frameAnnotations[0].label;
      annotation.title = frameAnnotations.map((item) => item.label).join("\n");
      button.append(annotation);
    }

    const preview = document.createElement("pre");
    preview.textContent = thumbnailText(frame);
    button.append(preview);
    fragment.append(button);
  });

  timeline.append(fragment);
  centerActiveThumbnail();
}

function renderDetails(sourceDetails: SourceDetails, trace: TraceReplay): void {
  details.innerHTML = "";

  const frame = trace.frames[state.frameIndex];
  const frameRow = document.createElement("div");
  frameRow.className = "details-row frame-context";
  frameRow.append(labelValue("Frame", `${state.frameIndex + 1} / ${trace.frames.length}`));
  frameRow.append(labelValue("Time", formatDuration(frame?.time ?? 0)));
  if (frame && frame.eventIndex >= 0) {
    frameRow.append(labelValue("Trace event", String(frame.eventIndex + 1)));
  }
  details.append(frameRow);

  const fileRow = document.createElement("div");
  fileRow.className = "details-row";
  fileRow.append(labelValue("Trace", trace.summary.filePath));
  if (trace.summary.testFile) {
    fileRow.append(labelValue("Source", `${trace.summary.testFile}${trace.summary.sourceLine ? `:${trace.summary.sourceLine}` : ""}`));
  }
  if (sourceDetails.scopeStartLine && sourceDetails.scopeEndLine) {
    fileRow.append(labelValue("Test block", `lines ${sourceDetails.scopeStartLine}-${sourceDetails.scopeEndLine}`));
  }
  if (trace.summary.attempt != null) {
    fileRow.append(labelValue("Attempt", String(trace.summary.attempt)));
  }
  details.append(fileRow);

  if (sourceDetails.snapshotFile || sourceDetails.snapshotNames.length > 0) {
    const snapshotRow = document.createElement("div");
    snapshotRow.className = "details-row";
    if (sourceDetails.snapshotFile) {
      snapshotRow.append(labelValue("Snapshot", sourceDetails.snapshotFile));
    }
    if (sourceDetails.snapshotNames.length > 0) {
      snapshotRow.append(labelValue("Snapshot names", sourceDetails.snapshotNames.join(", ")));
    }
    details.append(snapshotRow);
  }

  if (trace.annotations.length > 0) {
    const annotations = document.createElement("div");
    annotations.className = "annotations";
    const heading = document.createElement("div");
    heading.className = "details-heading";
    heading.textContent = "Annotations for current frame";
    annotations.append(heading);

    const currentAnnotations = annotationsForFrame(trace, state.frameIndex);
    if (currentAnnotations.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No annotations for this frame.";
      annotations.append(empty);
    } else {
      currentAnnotations.forEach((annotation) => {
        const line = document.createElement("div");
        line.className = "annotation-detail";
        const time = document.createElement("code");
        time.textContent = formatDuration(annotation.timeMs);
        const label = document.createElement("strong");
        label.textContent = annotation.label;
        line.append(time, label);
        if (annotation.description) {
          const description = document.createElement("span");
          description.textContent = annotation.description;
          line.append(description);
        }
        annotations.append(line);
      });
    }

    details.append(annotations);
  }

  const expectations = document.createElement("div");
  expectations.className = "expectations";
  const heading = document.createElement("div");
  heading.className = "details-heading";
  heading.textContent = "Assertions for current test";
  expectations.append(heading);

  if (sourceDetails.expectations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No test expectations or assertions found in this test block.";
    expectations.append(empty);
  } else {
    sourceDetails.expectations.forEach((expectation) => {
      const line = document.createElement("code");
      line.className = "expectation";
      line.textContent = `${expectation.line}: ${expectation.snippet}`;
      expectations.append(line);
    });
  }

  details.append(expectations);
}

function startPlayback(): void {
  const trace = currentTrace();
  if (!trace || trace.frames.length === 0) {
    return;
  }

  if (state.frameIndex >= trace.frames.length - 1) {
    state.frameIndex = 0;
    renderFrame(trace, 0);
  }

  state.playing = true;
  anchorPlayback(trace.frames[state.frameIndex].time, performance.now());
  renderControls(trace, state.playbackAnchorTraceTime);
  state.animationFrame = window.requestAnimationFrame(playbackTick);
}

function playbackTick(now: number): void {
  const trace = currentTrace();
  if (!trace || !state.playing) {
    return;
  }

  const traceTime = clamp(currentPlaybackTraceTime(now), 0, trace.summary.durationMs);
  renderPlaybackAt(trace, traceTime);

  if (traceTime >= trace.summary.durationMs) {
    stopPlayback();
    renderControls(trace);
    return;
  }

  state.animationFrame = window.requestAnimationFrame(playbackTick);
}

function stopPlayback(): void {
  state.playing = false;
  if (state.animationFrame != null) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = undefined;
  }
  syncProgress(currentTrace());
}

function setFrame(index: number): void {
  const trace = currentTrace();
  if (!trace) {
    return;
  }
  state.frameIndex = clamp(index, 0, trace.frames.length - 1);
  state.followTail = state.frameIndex >= trace.frames.length - 1;
  render();
  restorePageScroll();
}

function renderPlaybackAt(trace: TraceReplay, traceTime: number): void {
  const frameIndex = frameIndexAtTime(trace.frames, traceTime);
  if (frameIndex !== state.frameIndex) {
    renderFrame(trace, frameIndex);
  } else {
    renderControls(trace, traceTime);
  }
}

function renderFrame(trace: TraceReplay, frameIndex: number): void {
  state.frameIndex = clamp(frameIndex, 0, trace.frames.length - 1);
  state.followTail = state.frameIndex >= trace.frames.length - 1;
  renderTerminal(trace.frames[state.frameIndex]);
  renderControls(trace);
  renderFrameNotches(trace);
  renderTimeline(trace);
  renderDetails(trace.details, trace);
}

function currentTrace(): TraceReplay | undefined {
  return state.model?.traces[state.traceIndex];
}

function traceKey(trace: TraceReplay): string {
  return `${trace.summary.filePath}\n${trace.summary.testTitle}\n${trace.summary.attempt ?? ""}`;
}

function modelSignature(model: PreviewModel): string {
  return model.traces
    .map((trace) => {
      const lastFrame = trace.frames.at(-1);
      return [
        trace.summary.filePath,
        trace.summary.testTitle,
        trace.summary.attempt ?? "",
        trace.summary.frameCount,
        trace.summary.durationMs,
        trace.summary.rows,
        trace.summary.cols,
        lastFrame?.plainText ?? "",
        trace.annotations
          .map(
            (annotation) =>
              `${annotation.id}:${annotation.timeMs}:${annotation.frameIndex}:${annotation.kind ?? ""}:${annotation.color ?? ""}:${annotation.label}:${
                annotation.description ?? ""
              }`
          )
          .join("\u001d")
      ].join("\u001f");
    })
    .join("\u001e");
}

function applyStyle(span: HTMLElement, segment: CellSegment): void {
  if (segment.fg) span.style.color = segment.fg;
  if (segment.bg) span.style.backgroundColor = segment.bg;
  if (segment.bold) span.style.fontWeight = "700";
  if (segment.dim) span.style.opacity = "0.72";
  if (segment.italic) span.style.fontStyle = "italic";
  if (segment.underline) span.style.textDecoration = "underline";
  if (segment.cursor) span.classList.add("cursor");
}

function thumbnailText(frame: RenderedFrame): string {
  const lines = frame.plainText.split("\n").slice(0, 6);
  return lines.map((line) => line.slice(0, 28)).join("\n") || " ";
}

function colorForAnnotation(annotation: ResolvedTraceAnnotation): string {
  switch (annotation.kind) {
    case "oauth":
      return "#2f7d62";
    case "user":
      return "#8a5cf6";
    case "assertion":
      return "#b7791f";
    default:
      return "#2664d8";
  }
}

function centerActiveThumbnail(): void {
  const active = timeline.querySelector<HTMLElement>(".thumb.active");
  const strip = timeline.parentElement;
  if (!active || !strip) {
    return;
  }

  window.requestAnimationFrame(() => {
    const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo({
      left: Math.max(0, left),
      behavior: state.playing ? "auto" : "smooth"
    });
  });
}

function labelValue(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  const code = document.createElement("code");
  code.textContent = value;
  wrapper.append(strong, code);
  return wrapper;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function compactPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.slice(-3).join("/");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function syncProgress(trace: TraceReplay | undefined, traceTime?: number): void {
  frameProgress.style.transitionDuration = state.playing ? "0ms" : "160ms";
  frameProgress.style.width = `${traceTime == null ? progressForFrame(trace, state.frameIndex) : progressForTime(trace, traceTime)}%`;
}

function anchorPlayback(traceTime: number, now: number): void {
  state.playbackAnchorRealTime = now;
  state.playbackAnchorTraceTime = traceTime;
}

function currentPlaybackTraceTime(now: number): number {
  return state.playbackAnchorTraceTime + (now - state.playbackAnchorRealTime) * state.speed;
}

function progressForFrame(trace: TraceReplay | undefined, frameIndex: number): number {
  const frames = trace?.frames ?? [];
  if (frames.length === 0) {
    return 0;
  }

  const frame = frames[clamp(frameIndex, 0, frames.length - 1)];
  const duration = trace?.summary.durationMs ?? 0;
  if (duration > 0) {
    return roundTo(clamp((frame.time / duration) * 100, 0, 100), 3);
  }

  return roundTo(clamp((frame.index / Math.max(1, frames.length - 1)) * 100, 0, 100), 3);
}

function progressForTime(trace: TraceReplay | undefined, traceTime: number): number {
  const duration = trace?.summary.durationMs ?? 0;
  if (duration <= 0) {
    return progressForFrame(trace, state.frameIndex);
  }

  return roundTo(clamp((traceTime / duration) * 100, 0, 100), 3);
}

function rememberPageScroll(): void {
  pageScrollBeforeInteraction = { left: window.scrollX, top: window.scrollY };
}

function restorePageScroll(): void {
  const scroll = pageScrollBeforeInteraction ?? { left: 0, top: 0 };
  const target = scroll.top > 0 ? { left: 0, top: 0 } : scroll;

  const applyScroll = () => {
    window.scrollTo(target.left, target.top);
  };

  window.requestAnimationFrame(applyScroll);
  window.setTimeout(applyScroll, 0);
  pageScrollBeforeInteraction = undefined;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}
