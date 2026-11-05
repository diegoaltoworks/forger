/**
 * Reads the pixels of a PNG the browser produced, and writes the diff images.
 * Chromium writes 8-bit RGB or RGBA, not interlaced; anything else is refused
 * rather than misread.
 */

import {deflateSync, inflateSync} from 'zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): DecodedPng {
  if (SIGNATURE.some((b, i) => buf[i] !== b)) throw new Error('not a PNG');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 8 <= buf.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
      channels = colour === 2 ? 3 : 4;
    } else if (type === 'IDAT') parts.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[(y - 1) * stride + x - channels] : 0;
      const add = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : -1;
      if (add < 0) throw new Error(`unsupported PNG filter ${filter}`);
      out[y * stride + x] = (line[x] + add) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(out.subarray(i * channels, i * channels + 3), i * 4);
    rgba[i * 4 + 3] = channels === 4 ? out[i * channels + 3] : 255;
  }
  return {width, height, data: rgba};
}

/** An even grid of at most `max` opaque pixels as RGB triples. */
export function samplePixels(png: DecodedPng, max = 2500): Array<[number, number, number]> {
  const total = png.width * png.height;
  const step = Math.max(1, Math.ceil(total / max));
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < total; i += step) {
    if (png.data[i * 4 + 3] > 0) out.push([png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]]);
  }
  return out;
}

const CRC_TABLE = Uint32Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** An 8-bit RGBA PNG of the pixels. */
export function encodePng(png: DecodedPng): Uint8Array {
  const head = new Uint8Array(13);
  const view = new DataView(head.buffer);
  view.setUint32(0, png.width);
  view.setUint32(4, png.height);
  head.set([8, 6, 0, 0, 0], 8);
  const stride = png.width * 4;
  const raw = new Uint8Array(png.height * (stride + 1));
  for (let y = 0; y < png.height; y++) raw.set(png.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())].map(c => Buffer.from(c)));
}
