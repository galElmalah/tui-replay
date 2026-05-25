import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TraceAnnotation, TraceAnnotationsFile } from "./trace/types.js";

export type AnnotationSidecarOptions = {
  annotationPath?: string;
};

export type TraceAnnotationInput = TraceAnnotation;

export function annotationPathForTrace(tracePath: string, options: AnnotationSidecarOptions = {}): string {
  return options.annotationPath ?? `${tracePath}.annotations.json`;
}

export function defineTraceAnnotations(annotations: TraceAnnotationInput[], trace?: string): TraceAnnotationsFile {
  return {
    version: 1,
    trace,
    annotations: annotations.map((annotation, index) => normalizeAnnotation(annotation, index))
  };
}

export async function readTraceAnnotations(tracePath: string, options: AnnotationSidecarOptions = {}): Promise<TraceAnnotationsFile> {
  const annotationPath = annotationPathForTrace(tracePath, options);
  if (!fs.existsSync(annotationPath)) {
    return defineTraceAnnotations([], tracePath);
  }

  const parsed = JSON.parse(await readFile(annotationPath, "utf8")) as unknown;
  return parseTraceAnnotationsFile(parsed, annotationPath);
}

export async function writeTraceAnnotations(
  tracePath: string,
  annotations: TraceAnnotationInput[] | TraceAnnotationsFile,
  options: AnnotationSidecarOptions = {}
): Promise<string> {
  const annotationPath = annotationPathForTrace(tracePath, options);
  const file = Array.isArray(annotations) ? defineTraceAnnotations(annotations, tracePath) : parseTraceAnnotationsFile(annotations, annotationPath);
  await mkdir(path.dirname(annotationPath), { recursive: true });
  await writeFile(annotationPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return annotationPath;
}

export async function appendTraceAnnotation(
  tracePath: string,
  annotation: TraceAnnotationInput,
  options: AnnotationSidecarOptions = {}
): Promise<string> {
  const current = await readTraceAnnotations(tracePath, options);
  return writeTraceAnnotations(
    tracePath,
    {
      ...current,
      annotations: [...current.annotations, annotation]
    },
    options
  );
}

function parseTraceAnnotationsFile(value: unknown, annotationPath: string): TraceAnnotationsFile {
  if (Array.isArray(value)) {
    return defineTraceAnnotations(value);
  }

  if (!value || typeof value !== "object") {
    throw new Error(`Invalid trace annotations file: ${annotationPath}`);
  }

  const candidate = value as Partial<TraceAnnotationsFile>;
  if (candidate.version !== 1 || !Array.isArray(candidate.annotations)) {
    throw new Error(`Invalid trace annotations file: ${annotationPath}`);
  }

  return defineTraceAnnotations(candidate.annotations, candidate.trace);
}

function normalizeAnnotation(annotation: TraceAnnotationInput, index: number): TraceAnnotation {
  if (!annotation || typeof annotation !== "object") {
    throw new Error(`Invalid trace annotation at index ${index}`);
  }

  if (typeof annotation.label !== "string" || annotation.label.trim().length === 0) {
    throw new Error(`Trace annotation at index ${index} is missing a label`);
  }

  const targetCount = [annotation.timeMs, annotation.frameIndex, annotation.eventIndex].filter((value) => value != null).length;
  if (targetCount === 0) {
    throw new Error(`Trace annotation "${annotation.label}" needs timeMs, frameIndex, or eventIndex`);
  }

  for (const [name, value] of [
    ["timeMs", annotation.timeMs],
    ["frameIndex", annotation.frameIndex],
    ["eventIndex", annotation.eventIndex]
  ] as const) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Trace annotation "${annotation.label}" has an invalid ${name}`);
    }
  }

  return {
    ...annotation,
    label: annotation.label.trim(),
    description: annotation.description?.trim()
  };
}
