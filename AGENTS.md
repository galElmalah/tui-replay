# Agent Guide

This repo is a TypeScript ESM CLI package for replaying `@microsoft/tui-test` traces in four modes: browser preview, OpenTUI preview, terminal-only GIF export, and terminal-only video export.

## Success Criteria

For changes in this repo, keep the implementation scoped and verify with:

```bash
npm test
npm pack --dry-run
```

Run targeted smoke commands when changing a mode:

```bash
npm run preview -- examples/simple.tui-trace.json --project . --no-open
npm run tui -- examples/simple.tui-trace.json --project .
npm run gif -- examples/simple.tui-trace.json --output /tmp/tui-replay.gif --overlay
npm run video -- examples/simple.tui-trace.json --output /tmp/tui-replay.mp4 --overlay
```

The video command requires `ffmpeg` on `PATH`, `TUI_REPLAY_FFMPEG`, `FFMPEG_PATH`, `FFMPEG_BIN`, or `--ffmpeg-path`.

## CLI Modes

All command definitions and flags live in `src/cli.ts`.

| Mode | Command | Purpose |
| --- | --- | --- |
| Web preview | `tui-replay preview <trace...>` | Starts the browser viewer and file watcher. |
| TUI preview | `tui-replay tui <trace...>` | Starts the OpenTUI viewer. |
| GIF export | `tui-replay gif <trace>` | Writes an animated GIF of the terminal surface. |
| Video export | `tui-replay video <trace>` | Writes MP4 or WebM video of the terminal surface. |

Whenever a command or flag changes, update the CLI reference in `README.md` in the same change.

## Source Map

| Path | Responsibility |
| --- | --- |
| `src/cli.ts` | CLI command definitions, option parsing, and command output. |
| `src/server` | HTTP preview server, static HTML, and live reload events. |
| `src/viewer` | Browser-side replay UI. |
| `src/tui` | OpenTUI replay UI optimized for terminal use. |
| `src/gif` | GIF export entry point and tests. |
| `src/video` | Video export entry point and tests. |
| `src/media` | Shared terminal media rendering used by GIF and video export. |
| `src/preview` | Shared replay data source and preview model selectors. |
| `src/trace` | Trace loading, frame rendering, annotations, and shared types. |
| `src/source` | Best-effort source expectation extraction. |
| `src/sdk.ts` | Public annotation SDK. |

## Data Layer Rules

- Keep the web UI and TUI on the same replay data source interface from `src/preview/data-source.ts`.
- Keep GIF and video export on the shared terminal media renderer in `src/media/terminal-render.ts`.
- Keep media exports terminal-surface-only unless the user explicitly asks for viewer chrome.
- Do not fake terminal output with inserted newlines. Render frames from the trace and terminal state.
- Preserve trace sidecars. Annotation files are named `<trace>.annotations.json` and should not mutate upstream trace files.

## Testing Notes

- `npm test` runs `npm run build` and then Node's test runner against `dist/**/*.test.js`.
- `dist/` is generated and ignored. Build before running local CLI smoke tests, but do not commit generated output.
- Add or update tests when changing trace loading, frame rendering, source expectation extraction, annotations, GIF export, video export, or CLI parsing behavior.
- Video tests skip the export path when `ffmpeg` is unavailable. If you change video behavior and `ffmpeg` is installed locally, run an explicit CLI smoke test.

## Publishing Notes

The package is public on npm as `tui-replay`. Before publishing, run tests and a dry run:

```bash
npm test
npm pack --dry-run
npm publish --access public --otp <code>
```

Keep `package.json`, `package-lock.json`, `src/cli.ts`, and README version or command references aligned when preparing a release.
