import type { RenderedFrame, ResolvedTraceAnnotation, TraceReplay } from "../trace/types.js";

export function annotationsForFrame(trace: TraceReplay, frameIndex: number): ResolvedTraceAnnotation[] {
  return trace.annotations.filter((annotation) => annotation.frameIndex === frameIndex);
}

export function frameIndexAtTime(frames: RenderedFrame[], traceTime: number): number {
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time <= traceTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return clamp(high, 0, Math.max(0, frames.length - 1));
}

export function timelineFrames(frames: RenderedFrame[], selectedIndex: number, maxFrames = 260): RenderedFrame[] {
  if (frames.length <= maxFrames) {
    return frames;
  }

  const sampled = new Map<number, RenderedFrame>();
  const step = Math.ceil(frames.length / maxFrames);
  for (let i = 0; i < frames.length; i += step) {
    sampled.set(i, frames[i]);
  }

  sampled.set(0, frames[0]);
  sampled.set(selectedIndex, frames[selectedIndex]);
  sampled.set(frames.length - 1, frames.at(-1)!);

  return [...sampled.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, frame]) => frame);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
