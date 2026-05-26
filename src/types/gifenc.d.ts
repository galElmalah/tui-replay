declare module "gifenc" {
  export type GifPalette = number[][];

  export type GifEncoderOptions = {
    initialCapacity?: number;
    auto?: boolean;
  };

  export type GifFrameOptions = {
    palette?: GifPalette;
    delay?: number;
    repeat?: number;
    dispose?: number;
    transparent?: boolean;
    transparentIndex?: number;
    first?: boolean;
    colorDepth?: number;
  };

  export type GifEncoderInstance = {
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  };

  export function GIFEncoder(options?: GifEncoderOptions): GifEncoderInstance;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: string }): GifPalette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: string): Uint8Array;

  const gifenc: {
    GIFEncoder: typeof GIFEncoder;
    quantize: typeof quantize;
    applyPalette: typeof applyPalette;
  };

  export default gifenc;
}
