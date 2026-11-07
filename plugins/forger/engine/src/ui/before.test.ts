import {describe, expect, test} from 'bun:test';

import type {AppServer, Screenshotter, ShotRequest} from '../ports';
import {planBefore, runBefore, BEFORE_SCRATCH, COMPARE_DIR} from './before';
import {encodePng, type DecodedPng} from './png';
import {parseUiConfig} from './ui-config';

const config = parseUiConfig(JSON.stringify({
  paths: ['a'], start: 's', routes: ['/', '/about'], viewports: [{name: 'phone', width: 4, height: 4}], themes: ['light'],
  locales: [{code: 'en', dir: 'ltr', param: 'lang'}, {code: 'ar', dir: 'rtl', param: 'lang'}],
}));

function solid(rgb: [number, number, number]): Uint8Array {
  const img: DecodedPng = {width: 4, height: 4, data: new Uint8Array(64)};
  for (let i = 0; i < 16; i++) img.data.set([...rgb, 255], i * 4);
  return encodePng(img);
}

describe('screenshot --before', () => {
  test('plans a base capture and one side-by-side image per changed screen', async () => {
    const plan = planBefore(config);
    expect(plan.base.every(c => c.file.startsWith(BEFORE_SCRATCH))).toBe(true);
    expect(plan.pairs[0]).toEqual({before: `${BEFORE_SCRATCH}index-en-phone-light.png`, after: 'docs/screenshots/index-en-phone-light.png', out: `${COMPARE_DIR}index-en-phone-light.png`});

    const store = new Map<string, Uint8Array>();
    const order: string[] = [];
    const server = (name: string): AppServer => ({
      async start() { order.push(`start ${name}`); },
      async waitReady() {},
      async stop() { order.push(`stop ${name}`); },
    });
    const shooter: Screenshotter = {
      async capture(shots: ShotRequest[]) {
        for (const s of shots) {
          const file = (s.file as string).replace(/^\/root\//, '');
          const before = file.startsWith(BEFORE_SCRATCH);
          const changed = file.includes('about-ar');
          store.set(file, solid(before || !changed ? [250, 250, 250] : [10, 10, 10]));
        }
      },
    };
    const report = await runBefore(config, '/root', server('base'), server('head'), shooter, {
      read: p => store.get(p),
      write: (p, b) => void store.set(p, b),
    });
    expect(order).toEqual(['start base', 'stop base', 'start head', 'stop head']);
    expect(report.compare).toEqual([`${COMPARE_DIR}about-ar-phone-light.png`]);
    expect(report.unchanged).toHaveLength(plan.pairs.length - 1);
    expect(store.has(`${COMPARE_DIR}about-ar-phone-light.png`)).toBe(true);
    expect(store.has(`${COMPARE_DIR}index-en-phone-light.png`)).toBe(false);
  });
});
