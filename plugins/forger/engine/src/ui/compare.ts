/**
 * Whether a capture still matches its approved baseline: a pure function of two
 * images and a tolerance, and the side-by-side image that shows where they
 * differ.
 */

import type {DecodedPng} from './png';

export interface Tolerance {
  /** The largest per-channel difference (0-255) a pixel may have and still count as the same; anti-aliasing noise sits below it. */
  pixel: number;
  /** The share of pixels (0-1) that may differ beyond `pixel` before the images count as different. */
  area: number;
}

export const DEFAULT_TOLERANCE: Tolerance = {pixel: 16, area: 0.001};

export interface Comparison {
  same: boolean;
  /** Pixels that differ beyond the tolerance; a pixel present in only one image differs. */
  differing: number;
  /** Pixels compared: the area of the larger image. */
  total: number;
  sizeChanged: boolean;
}

function differs(a: DecodedPng, b: DecodedPng, x: number, y: number, pixel: number): boolean {
  if (x >= a.width || y >= a.height || x >= b.width || y >= b.height) return true;
  const i = (y * a.width + x) * 4;
  const j = (y * b.width + x) * 4;
  for (let c = 0; c < 4; c++) if (Math.abs(a.data[i + c] - b.data[j + c]) > pixel) return true;
  return false;
}

export function compareImages(baseline: DecodedPng, capture: DecodedPng, tolerance: Tolerance = DEFAULT_TOLERANCE): Comparison {
  const width = Math.max(baseline.width, capture.width);
  const height = Math.max(baseline.height, capture.height);
  let differing = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (differs(baseline, capture, x, y, tolerance.pixel)) differing++;
  const total = width * height;
  const sizeChanged = baseline.width !== capture.width || baseline.height !== capture.height;
  return {same: !sizeChanged && differing <= total * tolerance.area, differing, total, sizeChanged};
}

const GAP = 8;
const BACKGROUND = [128, 128, 128, 255];

/** Baseline, capture and the differing pixels in red over a faded capture, left to right. */
export function diffImage(baseline: DecodedPng, capture: DecodedPng, tolerance: Tolerance = DEFAULT_TOLERANCE): DecodedPng {
  const w = Math.max(baseline.width, capture.width);
  const h = Math.max(baseline.height, capture.height);
  const width = w * 3 + GAP * 2;
  const data = new Uint8Array(width * h * 4);
  for (let i = 0; i < width * h; i++) data.set(BACKGROUND, i * 4);
  const put = (panel: number, x: number, y: number, rgba: ArrayLike<number>): void => data.set(Array.from(rgba), (y * width + panel * (w + GAP) + x) * 4);
  const pixel = (img: DecodedPng, x: number, y: number): Uint8Array | null => (x < img.width && y < img.height ? img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4) : null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = pixel(baseline, x, y);
      const b = pixel(capture, x, y);
      if (a) put(0, x, y, a);
      if (b) put(1, x, y, b);
      put(2, x, y, differs(baseline, capture, x, y, tolerance.pixel) ? [255, 0, 0, 255] : b ? [b[0] / 4 + 191, b[1] / 4 + 191, b[2] / 4 + 191, 255] : BACKGROUND);
    }
  }
  return {width, height: h, data};
}

/** Before on the left and after on the right, each at its own size, top aligned. */
export function sideBySide(before: DecodedPng, after: DecodedPng): DecodedPng {
  const height = Math.max(before.height, after.height);
  const width = before.width + GAP + after.width;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(BACKGROUND, i * 4);
  for (let y = 0; y < before.height; y++) data.set(before.data.subarray(y * before.width * 4, (y + 1) * before.width * 4), y * width * 4);
  for (let y = 0; y < after.height; y++) data.set(after.data.subarray(y * after.width * 4, (y + 1) * after.width * 4), (y * width + before.width + GAP) * 4);
  return {width, height, data};
}
