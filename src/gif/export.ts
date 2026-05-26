import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import gifenc from "gifenc";
import {
  defaultTerminalOutputPath,
  loadTerminalRenderSource,
  renderTerminalFramePixels,
  terminalFrameDelay,
  type TerminalOverlayOptions,
  type TerminalOverlayPosition,
  type TerminalRenderOptions
} from "../media/terminal-render.js";

export type TerminalGifOverlayPosition = TerminalOverlayPosition;
export type TerminalGifOverlayOptions = TerminalOverlayOptions;

export type ExportTerminalGifOptions = TerminalRenderOptions & {
  output?: string;
  repeat?: number;
};

export type ExportTerminalGifResult = {
  outputPath: string;
  tracePath: string;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
};

export async function exportTerminalGif(options: ExportTerminalGifOptions): Promise<ExportTerminalGifResult> {
  const source = await loadTerminalRenderSource(options);
  const outputPath = path.resolve(options.output ?? defaultTerminalOutputPath(source.tracePath, "gif"));
  const encoder = gifenc.GIFEncoder({ initialCapacity: source.metrics.width * source.metrics.height });

  for (const [index, frame] of source.frames.entries()) {
    const pixels = renderTerminalFramePixels(frame, source.metrics);
    const palette = gifenc.quantize(pixels, 256, { format: "rgb565" });
    const indexed = gifenc.applyPalette(pixels, palette, "rgb565");
    encoder.writeFrame(indexed, source.metrics.width, source.metrics.height, {
      palette,
      delay: terminalFrameDelay(source.frames, index, options),
      repeat: options.repeat ?? 0
    });
  }

  encoder.finish();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, encoder.bytes());

  return {
    outputPath,
    tracePath: source.tracePath,
    frameCount: source.frames.length,
    width: source.metrics.width,
    height: source.metrics.height,
    durationMs: source.durationMs
  };
}
