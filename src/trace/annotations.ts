import path from "node:path";
import { readTraceAnnotations } from "../sdk.js";
import type { RenderedFrame, ResolvedTraceAnnotation, TraceAnnotation, TraceAnnotationAttachment } from "./types.js";

export async function loadResolvedTraceAnnotations(tracePath: string, frames: RenderedFrame[]): Promise<ResolvedTraceAnnotation[]> {
  const file = await readTraceAnnotations(tracePath);
  return file.annotations
    .map((annotation, index) => resolveTraceAnnotation(tracePath, annotation, frames, index))
    .filter((annotation): annotation is ResolvedTraceAnnotation => annotation != null);
}

function resolveTraceAnnotation(
  tracePath: string,
  annotation: TraceAnnotation,
  frames: RenderedFrame[],
  index: number
): ResolvedTraceAnnotation | undefined {
  if (frames.length === 0) {
    return undefined;
  }

  const frameIndex = resolveFrameIndex(annotation, frames);
  const frame = frames[frameIndex];

  return {
    ...annotation,
    id: annotation.id ?? `annotation-${index}`,
    timeMs: annotation.timeMs ?? frame.time,
    frameIndex,
    assertions: (annotation.assertions ?? []).map((assertion) => ({
      ...assertion,
      attachments: assertion.attachments?.map((attachment) => resolveAttachmentPath(tracePath, attachment))
    })),
    attachments: (annotation.attachments ?? []).map((attachment) => resolveAttachmentPath(tracePath, attachment))
  };
}

function resolveAttachmentPath(tracePath: string, attachment: TraceAnnotationAttachment): TraceAnnotationAttachment {
  if (!attachment.path) {
    return attachment;
  }

  return {
    ...attachment,
    path: path.isAbsolute(attachment.path) ? attachment.path : path.resolve(path.dirname(tracePath), attachment.path)
  };
}

function resolveFrameIndex(annotation: TraceAnnotation, frames: RenderedFrame[]): number {
  if (annotation.frameIndex != null) {
    return clamp(Math.round(annotation.frameIndex), 0, frames.length - 1);
  }

  if (annotation.eventIndex != null) {
    const eventIndex = Math.round(annotation.eventIndex);
    const exactFrame = frames.findIndex((frame) => frame.eventIndex === eventIndex);
    if (exactFrame >= 0) {
      return exactFrame;
    }

    const nextFrame = frames.findIndex((frame) => frame.eventIndex > eventIndex);
    if (nextFrame >= 0) {
      return nextFrame;
    }
  }

  return frameIndexAtTime(frames, annotation.timeMs ?? 0);
}

function frameIndexAtTime(frames: RenderedFrame[], timeMs: number): number {
  let low = 0;
  let high = frames.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time <= timeMs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return clamp(high, 0, Math.max(0, frames.length - 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
