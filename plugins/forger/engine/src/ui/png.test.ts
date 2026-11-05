import {describe, expect, test} from 'bun:test';
import {deflateSync} from 'zlib';

import {decodePng, samplePixels} from './png';

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  out.set(body, 8);
  return out;
}

/** An RGB PNG whose rows use the given filter types, built from already-filtered bytes. */
function png(width: number, height: number, colour: number, rows: number[][]): Uint8Array {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, colour, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.from(rows.flat()))), chunk('IEND', new Uint8Array())]);
}

describe('decoding a PNG', () => {
  test('rows with none, sub, up and average filters come back as the pixels they encode', () => {
    // 2x4 RGB; each row is a filter byte then 6 bytes.
    const decoded = decodePng(
      png(2, 4, 2, [
        [0, 10, 20, 30, 40, 50, 60],
        [1, 10, 20, 30, 30, 30, 30], // sub: second pixel = 40,50,60
        [2, 0, 0, 0, 0, 0, 0], // up: copies the row above
        [3, 5, 5, 5, 0, 0, 0], // average of left and up
      ])
    );
    expect(decoded.width).toBe(2);
    expect([...decoded.data.subarray(0, 8)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect([...decoded.data.subarray(8, 16)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect([...decoded.data.subarray(16, 24)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect([...decoded.data.subarray(24, 28)]).toEqual([10, 15, 20, 255]);
  });

  test('RGBA keeps its alpha and a transparent pixel is not sampled', () => {
    const decoded = decodePng(png(2, 1, 6, [[0, 1, 2, 3, 255, 9, 9, 9, 0]]));
    expect(samplePixels(decoded)).toEqual([[1, 2, 3]]);
  });

  test('sampling is bounded', () => {
    const rows = Array.from({length: 100}, () => [0, ...Array.from({length: 300}, () => 7)]);
    expect(samplePixels(decodePng(png(100, 100, 2, rows)), 500).length).toBeLessThanOrEqual(500);
  });

  test('unsupported or broken files are refused', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow('not a PNG');
    expect(() => decodePng(png(1, 1, 3, [[0, 0]]))).toThrow('unsupported PNG');
  });
});
