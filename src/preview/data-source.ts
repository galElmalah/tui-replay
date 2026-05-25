import { buildPreviewModel } from "./model.js";
import type { PreviewModel } from "../trace/types.js";

export type ReplayDataSourceOptions = {
  inputs: string[];
  projectRoot: string;
  retries?: number;
  retryDelayMs?: number;
};

export interface ReplayDataSource {
  readonly inputs: string[];
  readonly projectRoot: string;
  load(): Promise<PreviewModel>;
}

export function createReplayDataSource(options: ReplayDataSourceOptions): ReplayDataSource {
  return new FileReplayDataSource(options);
}

class FileReplayDataSource implements ReplayDataSource {
  readonly inputs: string[];
  readonly projectRoot: string;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(options: ReplayDataSourceOptions) {
    this.inputs = options.inputs;
    this.projectRoot = options.projectRoot;
    this.retries = options.retries ?? 6;
    this.retryDelayMs = options.retryDelayMs ?? 80;
  }

  async load(): Promise<PreviewModel> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        return await buildPreviewModel(this.inputs, this.projectRoot);
      } catch (error) {
        lastError = error;
        if (attempt < this.retries - 1) {
          await delay(this.retryDelayMs);
        }
      }
    }

    throw lastError;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
