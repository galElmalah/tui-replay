import fs from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { TuiTrace } from "./types.js";

const inflate = promisify(zlib.inflate);

export async function loadTraceFile(filePath: string): Promise<TuiTrace> {
  const raw = await readFile(filePath);
  const text = await inflateOrJson(raw);
  const parsed = JSON.parse(text) as unknown;

  if (!isTuiTrace(parsed)) {
    throw new Error(`File is not a tui-test trace: ${filePath}`);
  }

  return parsed;
}

export async function findTraceFiles(inputs: string[]): Promise<string[]> {
  const discovered = new Set<string>();

  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Trace path does not exist: ${input}`);
    }

    const inputStat = await stat(resolved);
    if (inputStat.isFile()) {
      discovered.add(resolved);
      continue;
    }

    if (inputStat.isDirectory()) {
      for (const filePath of await walkFiles(resolved)) {
        discovered.add(filePath);
      }
    }
  }

  return [...discovered].sort((a, b) => a.localeCompare(b));
}

export async function loadTraceInputs(inputs: string[]): Promise<Array<{ filePath: string; trace: TuiTrace }>> {
  const files = await findTraceFiles(inputs);
  const traces: Array<{ filePath: string; trace: TuiTrace }> = [];
  const failures: Array<{ filePath: string; error: unknown }> = [];

  for (const filePath of files) {
    try {
      traces.push({ filePath, trace: await loadTraceFile(filePath) });
    } catch (error) {
      failures.push({ filePath, error });
    }
  }

  if (traces.length === 0) {
    const details = failures
      .slice(0, 5)
      .map(({ filePath, error }) => `- ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      .join("\n");
    throw new Error(`No tui-test traces were found.${details ? `\n${details}` : ""}`);
  }

  return traces;
}

async function inflateOrJson(raw: Buffer): Promise<string> {
  try {
    return (await inflate(raw)).toString("utf8");
  } catch {
    return raw.toString("utf8");
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function isTuiTrace(value: unknown): value is TuiTrace {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as TuiTrace;
  return Array.isArray(candidate.tracePoints);
}
