export type DataTracePoint = {
  time: number;
  data: string;
};

export type SizeTracePoint = {
  rows: number;
  cols: number;
};

export type TracePoint = DataTracePoint | SizeTracePoint;

export type TuiTrace = {
  tracePoints: TracePoint[];
  testPath?: string[];
  testName?: string[];
  attempt?: number;
};

export type CellStyle = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  cursor?: boolean;
};

export type CellSegment = CellStyle & {
  text: string;
};

export type RenderedFrame = {
  index: number;
  eventIndex: number;
  time: number;
  rows: number;
  cols: number;
  lines: CellSegment[][];
  plainText: string;
};

export type TraceAnnotation = {
  id?: string;
  label: string;
  description?: string;
  kind?: string;
  color?: string;
  timeMs?: number;
  frameIndex?: number;
  eventIndex?: number;
  payload?: Record<string, unknown>;
};

export type TraceAnnotationsFile = {
  version: 1;
  trace?: string;
  annotations: TraceAnnotation[];
};

export type ResolvedTraceAnnotation = TraceAnnotation & {
  id: string;
  timeMs: number;
  frameIndex: number;
};

export type TraceSummary = {
  id: string;
  filePath: string;
  fileName: string;
  testTitle: string;
  testFile?: string;
  sourceLine?: number;
  attempt?: number;
  durationMs: number;
  frameCount: number;
  rows: number;
  cols: number;
};

export type SourceExpectation = {
  line: number;
  snippet: string;
};

export type SourceDetails = {
  sourceFile?: string;
  sourceLine?: number;
  scopeStartLine?: number;
  scopeEndLine?: number;
  snapshotFile?: string;
  snapshotNames: string[];
  expectations: SourceExpectation[];
};

export type TraceReplay = {
  summary: TraceSummary;
  frames: RenderedFrame[];
  annotations: ResolvedTraceAnnotation[];
  details: SourceDetails;
};

export type PreviewModel = {
  generatedAt: string;
  traces: TraceReplay[];
};
