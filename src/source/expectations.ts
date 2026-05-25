import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceDetails, SourceExpectation, TuiTrace } from "../trace/types.js";

const MAX_EXPECTATIONS = 30;

export async function extractSourceDetails(trace: TuiTrace, projectRoot: string): Promise<SourceDetails> {
  const sourceLocation = resolveSourceLocation(trace, projectRoot);
  if (!sourceLocation || !fs.existsSync(sourceLocation.sourceFile)) {
    return { snapshotNames: [], expectations: [] };
  }

  const source = await readFile(sourceLocation.sourceFile, "utf8");
  const snapshotFile = path.join(path.dirname(sourceLocation.sourceFile), "__snapshots__", `${path.basename(sourceLocation.sourceFile)}.snap`);
  const sourceScope = sourceLocation.sourceLine ? findTestScope(source, sourceLocation.sourceLine) : undefined;

  return {
    sourceFile: sourceLocation.sourceFile,
    sourceLine: sourceLocation.sourceLine,
    scopeStartLine: sourceScope?.startLine,
    scopeEndLine: sourceScope?.endLine,
    snapshotFile: fs.existsSync(snapshotFile) ? snapshotFile : undefined,
    snapshotNames: fs.existsSync(snapshotFile) ? await readSnapshotNames(snapshotFile, trace.testName ?? []) : [],
    expectations: extractExpectations(source, sourceScope)
  };
}

function resolveSourceLocation(trace: TuiTrace, projectRoot: string): { sourceFile: string; sourceLine?: number } | undefined {
  const testPath = trace.testPath;
  if (!testPath || testPath.length === 0) {
    return undefined;
  }

  const maybeLine = Number(testPath.at(-2));
  const hasLineAndColumn = Number.isFinite(maybeLine) && Number.isFinite(Number(testPath.at(-1)));
  const sourceParts = hasLineAndColumn ? testPath.slice(0, -2) : testPath;

  if (sourceParts.length === 0) {
    return undefined;
  }

  return {
    sourceFile: path.resolve(projectRoot, ...sourceParts),
    sourceLine: hasLineAndColumn ? maybeLine : undefined
  };
}

function extractExpectations(source: string, scope?: SourceScope): SourceExpectation[] {
  const expectations: SourceExpectation[] = [];
  const seen = new Set<string>();
  const scopedSource = scope ? source.slice(scope.startIndex, scope.endIndex) : source;
  const lineOffset = scope ? scope.startLine - 1 : 0;

  for (const startIndex of findCheckStarts(scopedSource)) {
    if (expectations.length >= MAX_EXPECTATIONS) {
      break;
    }

    const snippet = readStatement(scopedSource, startIndex);
    const line = lineOffset + lineNumberAt(scopedSource, startIndex);
    const key = `${line}:${snippet}`;

    if (isCheckSnippet(snippet) && !seen.has(key)) {
      seen.add(key);
      expectations.push({ line, snippet });
    }
  }

  return expectations;
}

type SourceScope = {
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
};

function findTestScope(source: string, sourceLine: number): SourceScope | undefined {
  const sourceIndex = indexAtLine(source, sourceLine);
  const testStart = source.lastIndexOf("test(", sourceIndex);

  if (testStart === -1) {
    return undefined;
  }

  const endIndex = findCallEnd(source, testStart);
  if (endIndex == null || endIndex < sourceIndex) {
    return undefined;
  }

  return {
    startIndex: testStart,
    endIndex,
    startLine: lineNumberAt(source, testStart),
    endLine: lineNumberAt(source, endIndex)
  };
}

function findCallEnd(source: string, startIndex: number): number | undefined {
  const openIndex = source.indexOf("(", startIndex);
  if (openIndex === -1) {
    return undefined;
  }

  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;

    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return i + 1;
    }
  }

  return undefined;
}

function findCheckStarts(source: string): number[] {
  const starts = new Set<number>();

  for (const token of ["expect(", "assert.", "assert("]) {
    let index = source.indexOf(token);
    while (index !== -1) {
      starts.add(index);
      index = source.indexOf(token, index + token.length);
    }
  }

  return [...starts].sort((a, b) => a - b);
}

function isCheckSnippet(snippet: string): boolean {
  return snippet.includes(".to") || /^assert(?:\.|\()/.test(snippet);
}

function readStatement(source: string, expectIndex: number): string {
  const start = Math.max(source.lastIndexOf("\n", expectIndex) + 1, 0);
  let end = expectIndex;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let i = expectIndex; i < source.length; i += 1) {
    const char = source[i];
    end = i + 1;

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;

    if ((char === ";" || char === "\n") && parenDepth <= 0 && bracketDepth <= 0 && braceDepth <= 0) {
      break;
    }
  }

  return source
    .slice(start, end)
    .replace(/\s+/g, " ")
    .replace(/^await\s+/, "")
    .replace(/;$/, "")
    .trim();
}

async function readSnapshotNames(snapshotFile: string, testName: string[]): Promise<string[]> {
  const source = await readFile(snapshotFile, "utf8");
  const names = [...source.matchAll(/exports\[`([^`]+)`\]/g)].map((match) => match[1]);
  const title = testName.join(" ");

  if (!title) {
    return names;
  }

  const matching = names.filter((name) => name.includes(title));
  return matching.length > 0 ? matching : names;
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function indexAtLine(source: string, line: number): number {
  if (line <= 1) {
    return 0;
  }

  let currentLine = 1;
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) {
      currentLine += 1;
      if (currentLine === line) {
        return i + 1;
      }
    }
  }

  return source.length;
}
