export function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TUI Replay</title>
    <style>${styles()}</style>
  </head>
  <body>
    <main class="app">
      <section id="stage" class="stage" aria-label="Terminal replay">
        <div id="terminal-window" class="terminal-window">
          <header class="topbar" aria-label="Viewer toolbar">
            <div class="window-controls" aria-hidden="true">
              <span class="traffic-light close"></span>
              <span class="traffic-light minimize"></span>
              <span class="traffic-light zoom"></span>
            </div>
            <div class="title-group">
              <h1>TUI Replay</h1>
              <p id="trace-meta"></p>
            </div>
            <div id="trace-picker" class="trace-picker">
              <button id="trace-trigger" class="trace-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
                <span id="trace-trigger-label"></span>
              </button>
              <div id="trace-menu" class="trace-menu" role="listbox" hidden></div>
            </div>
          </header>
          <div id="terminal" class="terminal" role="img" aria-label="Terminal frame"></div>
        </div>
      </section>

      <section class="controls" aria-label="Playback controls">
        <div class="scrubber-row">
          <div class="scrubber">
            <div class="scrubber-track" aria-hidden="true">
              <div id="frame-progress" class="frame-progress"></div>
              <div id="frame-notches" class="frame-notches"></div>
            </div>
            <input id="frame-range" type="range" min="0" max="0" value="0" aria-label="Frame">
          </div>
          <output id="frame-counter"></output>
        </div>
        <div class="transport-row">
          <button id="previous-frame" class="icon-button" type="button" aria-label="Previous frame">&#9198;</button>
          <button id="play-toggle" class="icon-button primary" type="button" aria-label="Play">&#9654;</button>
          <button id="next-frame" class="icon-button" type="button" aria-label="Next frame">&#9197;</button>
          <select id="speed-select" aria-label="Playback speed">
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
            <option value="8">8x</option>
          </select>
        </div>
      </section>

      <section class="timeline" aria-label="Frame previews">
        <div id="timeline"></div>
      </section>

      <section id="details" class="details" aria-label="Trace details"></section>
    </main>
    <script type="module" src="/assets/client.js"></script>
  </body>
</html>`;
}

function styles(): string {
  return `
:root {
  color: #1e242c;
  background: #f7f6f1;
  --ui-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono-font: "SFMono-Regular", "SF Mono", "Cascadia Mono", "Menlo", "Consolas", monospace;
  font-family: var(--ui-font);
  font-synthesis: none;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    linear-gradient(180deg, #fbfaf7 0%, #f2f0e9 100%);
}

button,
select,
input {
  font: inherit;
}

.app {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto auto;
  gap: 16px;
  padding: 22px clamp(16px, 3vw, 42px);
}

.topbar {
  position: relative;
  min-height: 32px;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) minmax(140px, 220px);
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid rgba(190, 184, 172, 0.8);
  background: rgba(246, 244, 240, 0.94);
  backdrop-filter: blur(18px);
  padding: 3px 10px;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-left: 2px;
}

.traffic-light {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.traffic-light.close {
  background: #ff5f57;
}

.traffic-light.minimize {
  background: #ffbd2e;
}

.traffic-light.zoom {
  background: #28c840;
}

.title-group {
  min-width: 0;
  text-align: center;
}

h1 {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

#trace-meta {
  min-height: 0;
  margin: 0;
  color: #5f6873;
  font-size: 11px;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

select {
  min-height: 24px;
  width: 100%;
  max-width: 100%;
  border: 1px solid rgba(212, 208, 198, 0.8);
  border-radius: 5px;
  background: rgba(255, 253, 250, 0.82);
  color: #20252d;
  padding: 0 8px;
  font-size: 12px;
}

.trace-picker {
  position: relative;
  min-width: 0;
}

.trace-trigger {
  width: 100%;
  min-width: 0;
  height: 22px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 10px;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(196, 190, 180, 0.78);
  border-radius: 999px;
  background: rgba(255, 253, 249, 0.72);
  color: #303742;
  padding: 0 8px 0 10px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}

.trace-trigger::after {
  content: "";
  width: 5px;
  height: 5px;
  border-right: 1.5px solid #6b7280;
  border-bottom: 1.5px solid #6b7280;
  transform: translateY(-1px) rotate(45deg);
}

.trace-trigger span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-trigger:hover,
.trace-trigger:focus-visible,
.trace-trigger[aria-expanded="true"] {
  border-color: rgba(117, 112, 104, 0.8);
  background: rgba(255, 253, 249, 0.92);
  outline: none;
}

.trace-picker.single .trace-trigger {
  grid-template-columns: minmax(0, 1fr);
  border-color: transparent;
  background: transparent;
  cursor: default;
}

.trace-picker.single .trace-trigger::after {
  display: none;
}

.trace-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  width: min(360px, 72vw);
  max-height: 260px;
  overflow: auto;
  padding: 4px;
  border: 1px solid rgba(190, 184, 172, 0.9);
  border-radius: 8px;
  background: rgba(255, 253, 249, 0.98);
  box-shadow: 0 14px 34px rgba(23, 28, 35, 0.18);
}

.trace-option {
  width: 100%;
  min-height: 30px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #303742;
  padding: 7px 8px;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.25;
}

.trace-option:hover,
.trace-option:focus-visible {
  background: #ebe7dd;
  outline: none;
}

.trace-option.active {
  background: #1f252e;
  color: #ffffff;
}

.stage {
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: auto;
  padding: 8px 0 18px;
}

.terminal-window {
  --cols: 80;
  --rows: 24;
  --cell-width: 10px;
  --line-height: 20px;
  --font-size: 15px;
  --window-width: calc((var(--cols) * var(--cell-width)) + 32px);
  --window-height: calc(32px + (var(--rows) * var(--line-height)) + 32px);
  width: min(var(--window-width), 100%);
  height: min(var(--window-height), 100%);
  min-width: min(100%, 420px);
  max-height: 100%;
  overflow: hidden;
  border: 1px solid #252a33;
  border-radius: 8px;
  background: #101318;
  box-shadow: 0 16px 40px rgba(23, 28, 35, 0.18);
}

.terminal {
  width: 100%;
  height: calc(100% - 32px);
  min-height: 0;
  overflow: auto;
  background: #101318;
  color: #d4d4d8;
  padding: 16px;
}

.terminal-line {
  width: calc(var(--cols) * var(--cell-width));
  height: var(--line-height);
  white-space: pre;
  font-family: var(--mono-font);
  font-size: var(--font-size);
  line-height: var(--line-height);
  letter-spacing: 0;
}

.terminal-line span {
  display: inline-block;
  height: var(--line-height);
}

.cursor {
  outline: 1px solid #f8fafc;
  outline-offset: -1px;
  background: #f8fafc !important;
  color: #101318 !important;
  animation: cursor-blink 1.05s steps(1, end) infinite;
}

@keyframes cursor-blink {
  0%,
  52% {
    opacity: 1;
  }

  53%,
  100% {
    opacity: 0.22;
  }
}

.controls {
  display: grid;
  gap: 8px;
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
}

.scrubber-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.transport-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
}

#speed-select {
  flex: 0 0 64px;
  width: 64px;
  min-width: 64px;
  max-width: 64px;
  min-height: 28px;
  padding: 0 6px;
}

.icon-button {
  width: 38px;
  height: 36px;
  border: 1px solid #d4d0c6;
  border-radius: 6px;
  background: #fffdfa;
  color: #1f252e;
  cursor: pointer;
}

.icon-button:hover,
.icon-button:focus-visible {
  border-color: #999286;
}

.icon-button.primary {
  background: #1f252e;
  border-color: #1f252e;
  color: #ffffff;
}

.scrubber {
  position: relative;
  min-width: 0;
  height: 32px;
  display: grid;
  align-items: center;
}

.scrubber-track {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 50%;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #d8d4ca;
  transform: translateY(-50%);
  box-shadow: inset 0 0 0 1px rgba(31, 37, 46, 0.08);
}

.frame-progress {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  border-radius: inherit;
  background: #1f252e;
  transition-property: width;
  transition-duration: 160ms;
  transition-timing-function: linear;
  will-change: width;
}

#frame-range {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 32px;
  margin: 0;
  cursor: pointer;
  opacity: 0;
}

.frame-notches {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

.frame-notch {
  position: absolute;
  top: 50%;
  width: 2px;
  height: 10px;
  border-radius: 999px;
  background: #8f968f;
  transform: translate(-50%, -50%);
  opacity: 0.65;
}

.frame-notch.active {
  width: 3px;
  height: 14px;
  background: #ffffff;
  box-shadow: 0 0 0 1px #1f252e;
  opacity: 1;
}

.annotation-marker {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  border: 2px solid #fffdfa;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(31, 37, 46, 0.35);
  transform: translate(-50%, -50%);
}

#frame-counter {
  min-width: 112px;
  text-align: right;
  color: #4e5661;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}

.timeline {
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
  overflow-x: scroll;
  overflow-y: hidden;
  padding: 0 0 8px;
  scrollbar-gutter: stable both-edges;
  scroll-snap-type: x proximity;
}

#timeline {
  display: flex;
  gap: 8px;
  justify-content: flex-start;
  min-width: max-content;
  width: max-content;
  padding: 0 2px;
}

.thumb {
  width: 140px;
  height: 82px;
  flex: 0 0 auto;
  scroll-snap-align: center;
  overflow: hidden;
  border: 1px solid #d8d4ca;
  border-radius: 6px;
  background: #fffdfa;
  color: #303742;
  cursor: pointer;
  padding: 6px;
  text-align: left;
}

.thumb.active {
  border-color: #1f252e;
  box-shadow: inset 0 0 0 1px #1f252e;
}

.thumb.annotated {
  border-color: #b7c8bd;
}

.thumb-time {
  display: block;
  color: #69717c;
  font-size: 11px;
  line-height: 1;
  margin-bottom: 5px;
  font-variant-numeric: tabular-nums;
}

.thumb-annotation {
  display: block;
  width: fit-content;
  max-width: 100%;
  margin-bottom: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: #e3efe8;
  color: #244c3d;
  padding: 2px 6px;
  font-size: 10px;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thumb pre {
  margin: 0;
  overflow: hidden;
  max-height: 54px;
  color: #1f252e;
  font-family: var(--mono-font);
  font-size: 9px;
  line-height: 1.15;
  white-space: pre;
}

.details {
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
  display: grid;
  gap: 8px;
  color: #303742;
  font-size: 13px;
}

.details-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.frame-context {
  padding-bottom: 2px;
}

.details code {
  color: #20252d;
  background: #ebe7dd;
  border-radius: 4px;
  padding: 2px 5px;
}

.expectations,
.annotations {
  display: grid;
  gap: 6px;
}

.annotation-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 8px;
}

.annotation-detail strong {
  color: #1f252e;
}

.annotation-detail span {
  color: #4e5661;
}

.details-heading {
  color: #4e5661;
  font-size: 12px;
  font-weight: 700;
}

.expectation {
  margin: 0;
  overflow-x: auto;
  white-space: pre;
  font-family: var(--mono-font);
  font-size: 12px;
  line-height: 1.45;
}

.empty {
  color: #69717c;
}

@media (max-width: 720px) {
  .app {
    grid-template-rows: minmax(0, 1fr) auto auto auto;
  }

  .topbar {
    grid-template-columns: 58px minmax(0, 1fr) minmax(110px, 150px);
    grid-template-areas: "controls title select";
    align-items: center;
  }

  .window-controls {
    grid-area: controls;
  }

  .title-group {
    grid-area: title;
    text-align: left;
  }

  .trace-picker {
    grid-area: select;
    max-width: 100%;
  }

  .scrubber-row {
    grid-template-columns: 1fr;
  }

  .transport-row {
    justify-content: flex-start;
  }

  #frame-counter {
    text-align: left;
  }
}
`;
}
