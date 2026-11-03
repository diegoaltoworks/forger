import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {resvgRasteriser} from '../adapters';
import {ICO_FILE, packIco, pngSize, RASTERS} from './plan';
import {renderBrand} from './render';

const DIR = join(import.meta.dir, '../../../../../assets/brand');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

describe('packIco', () => {
  test('lays out a header, one entry per image and the images whole', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const ico = packIco([{width: 16, height: 16, png: a}, {width: 256, height: 256, png: b}]);
    const view = new DataView(ico.buffer);
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2]);
    expect([ico[6], ico[7], view.getUint32(14, true), view.getUint32(18, true)]).toEqual([16, 16, 3, 38]);
    expect([ico[22], ico[23], view.getUint32(30, true), view.getUint32(34, true)]).toEqual([0, 0, 2, 41]);
    expect([...ico.slice(38)]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('pngSize', () => {
  test('reads the header, and refuses bytes that are not a PNG', () => {
    expect(pngSize(resvgRasteriser('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"/>', 8, 4))).toEqual({width: 8, height: 4});
    expect(pngSize(new Uint8Array(40))).toBeNull();
  });
});

describe('renderBrand over the committed SVGs', () => {
  const first = renderBrand(read, resvgRasteriser);

  test('writes every raster at its size, and the icon', () => {
    for (const r of RASTERS) expect(pngSize(first.get(r.file)!)).toEqual({width: r.width, height: r.height});
    const ico = first.get(ICO_FILE)!;
    expect(new DataView(ico.buffer).getUint16(4, true)).toBe(2);
  });

  test('a second run gives the same bytes', () => {
    const second = renderBrand(read, resvgRasteriser);
    for (const [name, bytes] of first) expect(Buffer.from(second.get(name)!).equals(Buffer.from(bytes))).toBe(true);
  });

  test('the committed rasters are what the SVGs render to', () => {
    for (const [name, bytes] of first) expect(Buffer.from(readFileSync(join(DIR, name))).equals(Buffer.from(bytes))).toBe(true);
  });

  test('every SVG outlines its text, so no font is needed', () => {
    for (const name of ['symbol', 'symbol-light', 'symbol-dark', 'favicon', 'avatar', 'wordmark-light', 'wordmark-dark', 'wordmark-orange', 'lockup-light', 'lockup-dark', 'social-preview']) {
      expect(read(`${name}.svg`)).not.toContain('<text');
    }
  });

  test('the social preview names this repository, not the sheet\'s', () => {
    expect(read('social-preview.svg')).toContain('<title>forger');
    expect(read('social-preview.svg')).not.toContain('forger-labs');
  });
});
