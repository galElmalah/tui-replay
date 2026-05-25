import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import open from "open";
import { renderIndexHtml } from "./html.js";
import { createReplayDataSource, type ReplayDataSource } from "../preview/data-source.js";

export type PreviewServerOptions = {
  inputs: string[];
  host: string;
  port: number;
  projectRoot: string;
  openBrowser: boolean;
  watch?: boolean;
};

export type PreviewServer = {
  url: string;
  close: () => Promise<void>;
};

type SseClient = {
  res: http.ServerResponse;
  heartbeat: NodeJS.Timeout;
};

type TraceWatcher = {
  close: () => void;
};

export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  const clientAsset = await readClientAsset();
  const selectorAsset = await readSelectorAsset();
  const dataSource = createReplayDataSource(options);
  const sseClients = new Set<SseClient>();
  let broadcastTimer: NodeJS.Timeout | undefined;

  const scheduleBroadcast = () => {
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
    }
    broadcastTimer = setTimeout(() => {
      broadcastTimer = undefined;
      void broadcastLatestModel(dataSource, sseClients);
    }, 180);
  };
  const watcher =
    options.watch === false
      ? undefined
      : await watchTraceInputs(options.inputs, () => {
          scheduleBroadcast();
        });

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, options, clientAsset, selectorAsset, dataSource, sseClients);
  });

  const port = await listen(server, options.host, options.port);
  const url = `http://${options.host}:${port}`;

  if (options.openBrowser) {
    await open(url);
  }

  return {
    url,
    close: () => {
      watcher?.close();
      if (broadcastTimer) {
        clearTimeout(broadcastTimer);
      }
      for (const client of sseClients) {
        clearInterval(client.heartbeat);
        client.res.end();
      }
      sseClients.clear();

      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: PreviewServerOptions,
  clientAsset: string,
  selectorAsset: string,
  dataSource: ReplayDataSource,
  sseClients: Set<SseClient>
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${options.host}:${options.port}`}`);

    if (url.pathname === "/") {
      send(res, 200, "text/html; charset=utf-8", renderIndexHtml());
      return;
    }

    if (url.pathname === "/api/traces") {
      const model = await dataSource.load();
      send(res, 200, "application/json; charset=utf-8", JSON.stringify(model));
      return;
    }

    if (url.pathname === "/api/events") {
      await connectSseClient(req, res, dataSource, sseClients);
      return;
    }

    if (url.pathname === "/assets/client.js") {
      send(res, 200, "text/javascript; charset=utf-8", clientAsset);
      return;
    }

    if (url.pathname === "/preview/selectors.js") {
      send(res, 200, "text/javascript; charset=utf-8", selectorAsset);
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", "Not found");
  } catch (error) {
    send(res, 500, "text/plain; charset=utf-8", error instanceof Error ? error.message : String(error));
  }
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

async function connectSseClient(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dataSource: ReplayDataSource,
  sseClients: Set<SseClient>
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  res.write(": connected\n\n");

  const client: SseClient = {
    res,
    heartbeat: setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000)
  };
  sseClients.add(client);

  req.on("close", () => {
    clearInterval(client.heartbeat);
    sseClients.delete(client);
  });

  try {
    sendSseEvent(res, "model", await dataSource.load());
  } catch (error) {
    sendSseEvent(res, "error", {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function broadcastLatestModel(dataSource: ReplayDataSource, sseClients: Set<SseClient>): Promise<void> {
  if (sseClients.size === 0) {
    return;
  }

  try {
    const model = await dataSource.load();
    for (const client of sseClients) {
      sendSseEvent(client.res, "model", model);
    }
  } catch (error) {
    const payload = {
      message: error instanceof Error ? error.message : String(error)
    };
    for (const client of sseClients) {
      sendSseEvent(client.res, "error", payload);
    }
  }
}

function sendSseEvent(res: http.ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  for (const line of JSON.stringify(payload).split("\n")) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

async function watchTraceInputs(inputs: string[], onChange: () => void): Promise<TraceWatcher> {
  const watchers = new Map<string, fs.FSWatcher>();
  let closed = false;
  let refreshTimer: NodeJS.Timeout | undefined;

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, 250);
  }

  function watchDir(dir: string) {
    if (closed || watchers.has(dir)) {
      return;
    }

    try {
      const watcher = fs.watch(dir, () => {
        onChange();
        scheduleRefresh();
      });
      watcher.on("error", () => {
        watchers.delete(dir);
        scheduleRefresh();
      });
      watchers.set(dir, watcher);
    } catch {
      // A watched path can briefly disappear while a test rewrites trace output.
    }
  }

  async function refresh() {
    if (closed) {
      return;
    }

    const dirs = new Set<string>();
    for (const input of inputs) {
      for (const dir of await watchDirsForInput(input)) {
        dirs.add(dir);
      }
    }

    for (const dir of dirs) {
      watchDir(dir);
    }
  }

  await refresh();

  return {
    close: () => {
      closed = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    }
  };
}

async function watchDirsForInput(input: string): Promise<string[]> {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    return [nearestExistingParent(resolved)];
  }

  const inputStat = await stat(resolved);
  if (inputStat.isFile()) {
    return [path.dirname(resolved)];
  }

  if (!inputStat.isDirectory()) {
    return [nearestExistingParent(resolved)];
  }

  return [resolved, ...(await walkDirectories(resolved))];
}

async function walkDirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.push(entryPath, ...(await walkDirectories(entryPath)));
    }
  }

  return dirs;
}

function nearestExistingParent(filePath: string): string {
  let current = path.dirname(filePath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return parent;
    }
    current = parent;
  }
  return current;
}

function listen(server: http.Server, host: string, preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = preferredPort;
    let attempts = 0;

    const tryListen = () => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && attempts < 20) {
          attempts += 1;
          port += 1;
          tryListen();
          return;
        }
        reject(error);
      };

      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : port);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    };

    tryListen();
  });
}

async function readClientAsset(): Promise<string> {
  const clientPath = new URL("../viewer/client.js", import.meta.url);
  return readFile(clientPath, "utf8");
}

async function readSelectorAsset(): Promise<string> {
  const selectorPath = new URL("../preview/selectors.js", import.meta.url);
  return readFile(selectorPath, "utf8");
}
