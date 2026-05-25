#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { startPreviewServer } from "./server/preview-server.js";

const program = new Command();

program
  .name("tui-replay")
  .description("Web replay viewer for @microsoft/tui-test traces.")
  .version("0.1.0");

program
  .command("preview")
  .description("serve a browser replay for one or more tui-test traces")
  .argument("<trace...>", "trace file or directory")
  .option("-p, --port <port>", "port to bind", parsePort, 4390)
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--project <dir>", "project root for resolving test files", process.cwd())
  .option("--no-watch", "disable live trace file watching")
  .option("--no-open", "do not open the browser")
  .action(async (inputs: string[], options: { port: number; host: string; project: string; watch: boolean; open: boolean }) => {
    const server = await startPreviewServer({
      inputs,
      host: options.host,
      port: options.port,
      projectRoot: options.project,
      watch: options.watch,
      openBrowser: options.open
    });

    process.stdout.write(`TUI Replay preview: ${server.url}\n`);
    process.stdout.write("Press Ctrl+C to stop.\n");

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

program
  .command("tui")
  .description("replay tui-test traces inside a terminal UI powered by OpenTUI")
  .argument("<trace...>", "trace file or directory")
  .option("--project <dir>", "project root for resolving test files", process.cwd())
  .action(async (inputs: string[], options: { project: string }) => {
    if (!isBunRuntime()) {
      await rerunCurrentCommandWithBun();
      return;
    }

    const { startOpenTuiPreview } = await import("./tui/open-tui-preview.js");
    await startOpenTuiPreview({
      inputs,
      projectRoot: options.project
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function isBunRuntime(): boolean {
  return typeof process.versions === "object" && "bun" in process.versions;
}

function rerunCurrentCommandWithBun(): Promise<void> {
  const cliPath = fileURLToPath(import.meta.url);
  const child = spawn("bun", [cliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env
  });

  return new Promise((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("The OpenTUI preview requires Bun or Node.js with FFI enabled. Install Bun, then rerun this command."));
        return;
      }
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}
