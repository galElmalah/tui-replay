# TUI Replay

View and replay [`@microsoft/tui-test`](https://github.com/microsoft/tui-test) traces from a browser, terminal UI, GIF, or video file.

TUI Replay is a TypeScript CLI package that reads `tui-test` trace files, reconstructs terminal frames with `@xterm/headless`, and exposes the same replay model to a clean web viewer, an OpenTUI-powered terminal viewer, terminal-only GIF exports, and terminal-only video exports. The viewers are read-only: they render what the test emitted, with replay controls, frame previews, timing, source assertions, and optional trace annotations.

## Screenshots

### Web preview

![TUI Replay web preview](docs/screenshots/web-preview.png)

### Terminal UI preview

![TUI Replay terminal UI preview](docs/screenshots/tui-preview.png)

## Features

- Preview a single `tui-test` trace file or an entire trace directory.
- Replay terminal output with play, pause, previous frame, next frame, and speed controls.
- Show a smooth timeline with frame switch notches and horizontally scrollable frame previews.
- Render terminal cell colors and cursor state through `@xterm/headless`.
- Watch trace files and directories so newly written test traces appear without restarting the server.
- Export animated GIF, MP4, or WebM media of the terminal surface only.
- Add optional media overlays showing `Frame x / y` and the current replay timestamp.
- Show source context from the test file, including nearby `assert`, `expect`, and snapshot calls when available.
- Add sidecar annotations for events such as OAuth, user actions, policy decisions, or checkpoints.
- Use one shared replay data layer for the web UI and the TUI.
- Use one shared terminal media renderer for GIF and video export.

## Install

```bash
npm install tui-replay
```

For local development from this repo:

```bash
npm install
npm run build
```

## Quick Start

```bash
tui-replay preview .tui-test/cache/tui-traces --project .
tui-replay tui .tui-test/cache/tui-traces --project .
tui-replay gif .tui-test/cache/tui-traces/my-test-trace --output trace.gif --overlay
tui-replay video .tui-test/cache/tui-traces/my-test-trace --output trace.mp4 --overlay
```

During local development, run the built CLI directly:

```bash
node dist/cli.js preview examples/simple.tui-trace.json --project .
node dist/cli.js tui examples/simple.tui-trace.json --project .
node dist/cli.js gif examples/simple.tui-trace.json --output simple.gif
node dist/cli.js video examples/simple.tui-trace.json --output simple.mp4
```

## CLI Reference

The top-level command is:

```bash
tui-replay <command> [options]
```

Global flags:

| Flag | Description |
| --- | --- |
| `-V, --version` | Print the installed TUI Replay version. |
| `-h, --help` | Show top-level help. |

Commands:

| Command | Purpose |
| --- | --- |
| `preview <trace...>` | Serve the browser replay viewer for one or more trace files or directories. |
| `tui <trace...>` | Open the terminal UI replay viewer powered by OpenTUI. |
| `gif <trace>` | Export the terminal surface to an animated GIF. |
| `video <trace>` | Export the terminal surface to MP4 or WebM video. |

Trace arguments can be raw JSON traces, zlib-deflated `@microsoft/tui-test` traces, files without extensions, or directories containing many trace files.

### `preview`

```bash
tui-replay preview <trace...> [options]
```

Starts a local web server with a clean browser replay UI.

| Flag | Default | Description |
| --- | --- | --- |
| `-p, --port <port>` | `4390` | Port to bind. Use `0` to let the OS choose an available port. |
| `--host <host>` | `127.0.0.1` | Host address to bind. |
| `--project <dir>` | Current working directory | Project root used to resolve test source files and source assertions. |
| `--no-watch` | Watch enabled | Disable live trace file watching. |
| `--no-open` | Opens browser | Do not open the browser automatically. |
| `-h, --help` | | Show command help. |

Example:

```bash
tui-replay preview .tui-test/cache/tui-traces --project . --port 4390
```

The web viewer watches inputs by default. For directories, it detects new trace files. For files, it reloads when the trace or its annotation sidecar changes. `@microsoft/tui-test` writes trace data when the test framework flushes the trace file; TUI Replay updates as soon as that file appears or changes.

### `tui`

```bash
tui-replay tui <trace...> [options]
```

Runs the OpenTUI terminal viewer.

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | Current working directory | Project root used to resolve test source files and source assertions. |
| `-h, --help` | | Show command help. |

Controls:

| Key | Action |
| --- | --- |
| `Space` | Play or pause. |
| `Left` / `Right` | Previous or next frame. |
| `Home` / `End` | First or last frame. |
| `Up` / `Down` | Increase or decrease playback speed. |
| `.` / `,` | Next or previous trace. |
| `q` / `Esc` | Quit. |

OpenTUI currently works best under Bun. The Node CLI automatically reruns the `tui` command with `bun` when Bun is available.

### `gif`

```bash
tui-replay gif <trace> [options]
```

Exports an animated GIF of the terminal display. The exported GIF includes only the terminal surface, not the browser or TUI controls.

| Flag | Default | Description |
| --- | --- | --- |
| `-o, --output <file>` | `<trace-name>.gif` | Output GIF path. |
| `--trace-index <index>` | `0` | Trace index to export when the input resolves to multiple traces. |
| `--speed <rate>` | `1` | Playback speed multiplier. `2` exports at twice the trace speed. |
| `--repeat <count>` | `0` | GIF repeat count. `0` repeats forever, `-1` plays once, positive values repeat that many times. |
| `--min-delay <ms>` | `20` | Minimum encoded frame delay. |
| `--last-delay <ms>` | `1000` | Delay for the final frame. |
| `--scale <scale>` | `1` | Output scale multiplier. |
| `--font-size <px>` | `14` | Terminal font size before scale. |
| `--cell-width <px>` | Derived from font size | Terminal cell width before scale. |
| `--line-height <px>` | Derived from font size | Terminal line height before scale. |
| `--padding <px>` | Derived from font size | Terminal padding before scale. |
| `--font-family <family>` | `Menlo, Monaco, Consolas, monospace` | Terminal font family. |
| `--overlay` | Disabled | Draw a `Frame x / y | timestamp` metadata pill over the terminal. |
| `--overlay-position <position>` | `bottom-right` | Overlay position: `top-left`, `top-right`, `bottom-left`, or `bottom-right`. |
| `--overlay-background <color>` | `#05080c` | Overlay background color. |
| `--overlay-foreground <color>` | `#f8fafc` | Overlay text color. |
| `-h, --help` | | Show command help. |

Example:

```bash
tui-replay gif .tui-test/cache/tui-traces/my-test-trace \
  --output my-test.gif \
  --speed 2 \
  --scale 0.75 \
  --overlay \
  --overlay-position bottom-right
```

### `video`

```bash
tui-replay video <trace> [options]
```

Exports MP4 or WebM video of the terminal display. The video exporter uses `ffmpeg`; install `ffmpeg` on your `PATH`, set `TUI_REPLAY_FFMPEG`, set `FFMPEG_PATH`, set `FFMPEG_BIN`, or pass `--ffmpeg-path`.

Video quality is mostly controlled by output resolution. TUI Replay renders video at `--scale 2` by default so text stays crisp when previewed inline or embedded in docs. Increase `--scale`, `--font-size`, or lower `--crf` for sharper output; lower `--scale` or raise `--crf` for smaller files.

If `ffmpeg` cannot be resolved, the CLI exits with an actionable `TUI_REPLAY_FFMPEG_NOT_FOUND` message. That message lists the checked configuration paths and includes install or retry options for humans and automation.

| Flag | Default | Description |
| --- | --- | --- |
| `-o, --output <file>` | `<trace-name>.mp4` or selected format | Output video path. |
| `--format <format>` | Inferred from output extension, otherwise `mp4` | Video format: `mp4` or `webm`. |
| `--ffmpeg-path <file>` | Auto-detected | Path to an `ffmpeg` binary. |
| `--fps <rate>` | `60` | Output video frame rate. Higher values produce smoother timing with more duplicated frames. |
| `--trace-index <index>` | `0` | Trace index to export when the input resolves to multiple traces. |
| `--speed <rate>` | `1` | Playback speed multiplier. |
| `--min-delay <ms>` | `20` | Minimum frame delay before frame duplication. |
| `--last-delay <ms>` | `1000` | Delay for the final frame. |
| `--scale <scale>` | `2` | Output scale multiplier. |
| `--font-size <px>` | `14` | Terminal font size before scale. |
| `--cell-width <px>` | Derived from font size | Terminal cell width before scale. |
| `--line-height <px>` | Derived from font size | Terminal line height before scale. |
| `--padding <px>` | Derived from font size | Terminal padding before scale. |
| `--font-family <family>` | `Menlo, Monaco, Consolas, monospace` | Terminal font family. |
| `--overlay` | Disabled | Draw a `Frame x / y | timestamp` metadata pill over the terminal. |
| `--overlay-position <position>` | `bottom-right` | Overlay position: `top-left`, `top-right`, `bottom-left`, or `bottom-right`. |
| `--overlay-background <color>` | `#05080c` | Overlay background color. |
| `--overlay-foreground <color>` | `#f8fafc` | Overlay text color. |
| `--crf <value>` | `16` for MP4, `28` for WebM | Encoder quality value. Lower usually means higher quality and larger files. |
| `--preset <preset>` | `medium` | ffmpeg encoder preset for MP4 output. |
| `-h, --help` | | Show command help. |

Examples:

```bash
tui-replay video .tui-test/cache/tui-traces/my-test-trace \
  --output my-test.mp4 \
  --overlay \
  --overlay-position top-right

tui-replay video .tui-test/cache/tui-traces/my-test-trace \
  --output my-test.webm \
  --format webm
```

High quality sharing example:

```bash
tui-replay video .tui-test/cache/tui-traces/my-test-trace \
  --output my-test-hq.mp4 \
  --scale 3 \
  --fps 60 \
  --crf 14 \
  --overlay
```

Missing `ffmpeg` remediation examples:

```bash
brew install ffmpeg
tui-replay video .tui-test/cache/tui-traces/my-test-trace --output my-test.mp4

tui-replay video .tui-test/cache/tui-traces/my-test-trace \
  --output my-test.mp4 \
  --ffmpeg-path /absolute/path/to/ffmpeg
```

## Annotation SDK

Annotations are stored next to the trace in a sidecar JSON file named `<trace>.annotations.json`. This keeps upstream trace files untouched while letting tests or helper scripts add domain-specific timeline markers.

```ts
import { appendTraceAnnotation, writeTraceAnnotations } from "tui-replay/sdk";

await writeTraceAnnotations("./.tui-test/cache/tui-traces/oauth-flow", [
  {
    timeMs: 12_400,
    label: "User opened OAuth",
    kind: "oauth",
    description: "The CLI opened the provider authorization URL"
  }
]);

await appendTraceAnnotation("./.tui-test/cache/tui-traces/oauth-flow", {
  frameIndex: 42,
  label: "OAuth callback received",
  kind: "oauth",
  color: "#1f8a70"
});
```

Annotation targets can use `timeMs`, `frameIndex`, or `eventIndex`. During model building, annotations are resolved to the nearest frame and shown on the timeline, thumbnails, and details surface.

Sidecar format:

```json
{
  "version": 1,
  "trace": "./.tui-test/cache/tui-traces/oauth-flow",
  "annotations": [
    {
      "timeMs": 12400,
      "label": "User opened OAuth",
      "kind": "oauth",
      "description": "The CLI opened the provider authorization URL"
    }
  ]
}
```

## SDK Usage

The web server, TUI, GIF exporter, and video exporter share the same trace loading and terminal reconstruction pipeline.

```ts
import { createReplayDataSource } from "tui-replay";

const dataSource = createReplayDataSource({
  inputs: ["./.tui-test/cache/tui-traces"],
  projectRoot: process.cwd()
});

const model = await dataSource.load();
```

Media exports are also available programmatically:

```ts
import { exportTerminalGif } from "tui-replay/gif";
import { exportTerminalVideo } from "tui-replay/video";

await exportTerminalGif({
  input: "./.tui-test/cache/tui-traces/my-test-trace",
  output: "./my-test.gif",
  speed: 2,
  scale: 0.75,
  overlay: {
    position: "bottom-right"
  }
});

await exportTerminalVideo({
  input: "./.tui-test/cache/tui-traces/my-test-trace",
  output: "./my-test.mp4",
  overlay: true
});
```

## Trace Support

TUI Replay accepts:

- zlib-deflated JSON traces from `@microsoft/tui-test`.
- Raw JSON trace fixtures for development and tests.
- Trace files with or without extensions.
- Directories containing many traces.

Each trace point is replayed through a headless terminal renderer. The viewers and media exporters display the resulting cell grid instead of running an interactive terminal emulator.

## Development

```bash
npm install
npm test
```

Common commands:

```bash
npm run build
npm run preview -- examples/simple.tui-trace.json --project .
npm run tui -- examples/simple.tui-trace.json --project .
npm run gif -- examples/simple.tui-trace.json --output simple.gif
npm run video -- examples/simple.tui-trace.json --output simple.mp4
```

Project layout:

| Path | Purpose |
| --- | --- |
| `src/cli.ts` | CLI command definitions and option parsing. |
| `src/server` | HTTP server, static HTML, and live reload events. |
| `src/viewer` | Browser-side replay UI. |
| `src/tui` | OpenTUI replay UI. |
| `src/gif` | Terminal GIF export wrapper. |
| `src/video` | Terminal video export wrapper. |
| `src/media` | Shared terminal media rendering used by GIF and video export. |
| `src/preview` | Shared replay data source and selectors. |
| `src/trace` | Trace loading, rendering, annotations, and types. |
| `src/source` | Best-effort source expectation extraction. |
| `src/sdk.ts` | Annotation SDK. |

## Agent Notes

Repo-level guidance for coding agents lives in [AGENTS.md](AGENTS.md). When adding or changing CLI flags, update this README command reference and the relevant tests in the same change.

## License

MIT
