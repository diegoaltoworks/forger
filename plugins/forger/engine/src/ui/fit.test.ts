import {describe, expect, test} from 'bun:test';

import type {AppServer, PageModel, ShotRequest, Screenshotter} from '../ports';
import {longestString, runFit} from './fit';
import {parseUiConfig} from './ui-config';

const config = parseUiConfig(
  JSON.stringify({
    paths: ['a'], start: 's', url: 'http://localhost:9', routes: ['/'], themes: ['light'], ready_timeout: 5,
    viewports: [{name: 'desktop', width: 1280, height: 800}, {name: 'phone', width: 390, height: 844}],
    locales: [{code: 'en', dir: 'ltr', param: 'lang'}, {code: 'de', dir: 'ltr', param: 'lang'}],
  })
);

const server: AppServer = {async start() {}, async waitReady() {}, async stop() {}};

/** A browser whose text is 100px wide per 100%, in a box as wide as the viewport allows. */
function shooter(seen: ShotRequest[] = [], textOf: (s: ShotRequest) => number = s => 100 * (s.fit?.scale ?? 1)): Screenshotter {
  return {
    async capture(shots) {
      seen.push(...shots);
      return shots.map((s): PageModel => {
        const textWidth = textOf(s);
        const availableWidth = s.width / 4;
        return {viewport: {width: s.width, height: s.height}, console: [], elements: {}, fits: [{textWidth, availableWidth, wraps: textWidth > availableWidth, clipped: false}]};
      });
    },
  };
}

describe('measure', () => {
  test('measure reports text width against available width at each viewport, narrowest first', async () => {
    const report = await runFit(config, '/', '.title', server, shooter());
    expect(report.rows[0]).toMatchObject({viewport: 'phone', scale: 200, textWidth: 200, availableWidth: 97.5, wraps: true});
    const phone100 = report.rows.filter(r => r.scale === 100 && r.locale === 'en').map(r => r.viewport);
    expect(phone100).toEqual(['phone', 'desktop']);
    const headrooms = report.rows.map(r => r.headroom);
    expect(headrooms).toEqual([...headrooms].sort((a, b) => a - b));
    expect(new Set(report.rows.map(r => r.locale))).toEqual(new Set(['en', 'de']));
    expect(report.fits).toBe(false);
  });

  test('measure at a 200 percent text scale reports the wider width', async () => {
    const report = await runFit(config, '/', '.title', server, shooter());
    const at = (scale: number) => report.rows.find(r => r.scale === scale && r.viewport === 'desktop' && r.locale === 'en')!;
    expect(at(200).textWidth).toBeGreaterThan(at(100).textWidth);
    expect(at(200).headroom).toBeLessThan(at(100).headroom);
  });

  test('measure with a text file uses the longest string', async () => {
    const text = longestString(JSON.stringify({a: 'short', nested: {b: 'the longest label of them all', c: ['mid size']}}));
    expect(text).toBe('the longest label of them all');
    const seen: ShotRequest[] = [];
    await runFit(config, '/', '.title', server, shooter(seen), text);
    expect(seen.every(s => s.fit?.text === text)).toBe(true);
  });

  test('a line-per-string file also gives its longest line', () => {
    expect(longestString('one\n  three words  \ntwo\n')).toBe('three words');
  });

  test('a named state is measured after its steps, and an unknown target is refused', async () => {
    const withState = parseUiConfig(JSON.stringify({paths: ['a'], start: 's', url: 'http://x', routes: ['/'], themes: ['light'], states: [{name: 'open', route: '/', steps: [{click: '#m'}]}]}));
    const seen: ShotRequest[] = [];
    await runFit(withState, 'open', 'h1', server, shooter(seen));
    expect(seen[0]?.steps).toEqual([{click: '#m'}]);
    await expect(runFit(withState, 'nope', 'h1', server, shooter())).rejects.toThrow('neither a route nor a named state');
  });

  test('stops the app even when the browser fails', async () => {
    const calls: string[] = [];
    const s: AppServer = {async start() {}, async waitReady() {}, async stop() { calls.push('stop'); }};
    await expect(runFit(config, '/', 'h1', s, {async capture() { throw new Error('boom'); }})).rejects.toThrow('boom');
    expect(calls).toEqual(['stop']);
  });
});
