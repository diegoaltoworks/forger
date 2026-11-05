import {describe, expect, test} from 'bun:test';

import {DEFAULT_TOLERANCE, compareImages, diffImage} from './compare';
import {decodePng, encodePng, type DecodedPng} from './png';

function solid(width: number, height: number, rgb: [number, number, number]): DecodedPng {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return {width, height, data};
}

function paint(img: DecodedPng, x: number, y: number, rgb: [number, number, number]): DecodedPng {
  const data = img.data.slice();
  data.set([...rgb, 255], (y * img.width + x) * 4);
  return {...img, data};
}

describe('compareImages', () => {
  const base = solid(40, 40, [250, 250, 250]);

  test('identical images are the same', () => {
    expect(compareImages(base, base)).toMatchObject({same: true, differing: 0, total: 1600});
  });

  test('anti-aliasing noise under the pixel tolerance stays the same, however many pixels it touches', () => {
    let noisy = base;
    for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y += 2) noisy = paint(noisy, x, y, [245, 252, 248]);
    expect(compareImages(base, noisy)).toMatchObject({same: true, differing: 0});
  });

  test('a few pixels beyond the pixel tolerance stay under the area tolerance', () => {
    const one = paint(base, 3, 3, [0, 0, 0]);
    expect(compareImages(base, one, {pixel: 16, area: 0.001})).toMatchObject({same: true, differing: 1});
  });

  test('a region beyond both tolerances is different', () => {
    let changed = base;
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) changed = paint(changed, x, y, [200, 20, 20]);
    expect(compareImages(base, changed)).toMatchObject({same: false, differing: 100});
  });

  test('a different size is different even when every shared pixel matches', () => {
    expect(compareImages(base, solid(40, 41, [250, 250, 250]))).toMatchObject({same: false, sizeChanged: true, differing: 40});
  });

  test('the default tolerance is the one the config falls back to', () => {
    expect(DEFAULT_TOLERANCE).toEqual({pixel: 16, area: 0.001});
  });
});

describe('diffImage', () => {
  test('lays baseline, capture and the differing pixels side by side', () => {
    const was = solid(4, 2, [10, 20, 30]);
    const now = paint(was, 1, 1, [255, 255, 255]);
    const diff = diffImage(was, now);
    expect(diff.width).toBe(4 * 3 + 16);
    expect(diff.height).toBe(2);
    const at = (panel: number, x: number, y: number): number[] => Array.from(diff.data.subarray((y * diff.width + panel * 12 + x) * 4, (y * diff.width + panel * 12 + x) * 4 + 4));
    expect(at(0, 1, 1)).toEqual([10, 20, 30, 255]);
    expect(at(1, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(at(2, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(2, 0, 0)).not.toEqual([255, 0, 0, 255]);
  });

  test('survives a PNG round trip', () => {
    const img = paint(solid(3, 3, [1, 2, 3]), 2, 2, [9, 8, 7]);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(3);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });
});
