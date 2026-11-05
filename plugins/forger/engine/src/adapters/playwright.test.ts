import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {UiInfrastructureError} from '../ports';
import {AXE_HINT, PLAYWRIGHT_HINT, ffmpegGifEncoder, loadAxeSource, loadPlaywright, playwrightAuditor, playwrightRecorder, playwrightScreenshotter} from './playwright';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

describe('the Playwright adapter', () => {
  test('a project without Playwright is told how to add it, as an infrastructure error', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    try {
      loadPlaywright(root);
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UiInfrastructureError);
      expect((e as UiInfrastructureError).category).toBe('playwright-missing');
      expect((e as Error).message).toBe(PLAYWRIGHT_HINT);
    }
  });

  test('drives one context per shot with its viewport and colour scheme, and always closes the browser', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    const log: string[] = [];
    const fake = {
      chromium: {
        async launch() {
          return {
            async newContext(o: {viewport: {width: number; height: number}; colorScheme: string}) {
              log.push(`context ${o.viewport.width}x${o.viewport.height} ${o.colorScheme}`);
              return {
                async newPage() {
                  return {
                    async goto(url: string) {
                      log.push(`goto ${url}`);
                    },
                    async screenshot(o: {path: string}) {
                      log.push(`shot ${o.path}`);
                      throw new Error('disk full');
                    },
                    async addScriptTag() {},
                    async evaluate() {},
                  };
                },
                async close() {
                  log.push('close context');
                },
              };
            },
            async close() {
              log.push('close browser');
            },
          };
        },
      },
    };
    const shooter = playwrightScreenshotter(root, () => fake);
    const file = join(root, 'docs', 'screenshots', 'a.png');
    await expect(shooter.capture([{url: 'http://x/', width: 10, height: 20, theme: 'dark', file}])).rejects.toThrow('disk full');
    expect(log).toEqual(['context 10x20 dark', 'goto http://x/', `shot ${file}`, 'close context', 'close browser']);
  });

  test('runs the steps of a state in order after the page loads and before the capture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    const log: string[] = [];
    const page = {
      async goto(url: string) { log.push(`goto ${url}`); },
      async screenshot(o: {path: string}) { log.push(`shot ${o.path}`); },
      async addScriptTag() {},
      async evaluate() {},
      async waitForSelector(s: string) { log.push(`wait ${s}`); },
      async click(s: string) { log.push(`click ${s}`); },
      async tap(s: string) { log.push(`tap ${s}`); },
      async fill(s: string, v: string) { log.push(`fill ${s}=${v}`); },
      async waitForTimeout(ms: number) { log.push(`pause ${ms}`); },
      keyboard: {async press(k: string) { log.push(`key ${k}`); }},
    };
    const fake = {chromium: {async launch() {
      return {
        async newContext() { return {async newPage() { return page; }, async close() {}}; },
        async close() {},
      };
    }}};
    const file = join(root, 'docs', 'screenshots', 'a.png');
    await playwrightScreenshotter(root, () => fake).capture([
      {url: 'http://x/list?f=1', width: 1, height: 1, theme: 'light', steps: [{click: '#f'}, {fill: {selector: '#q', value: 'a'}}, {wait: '.row'}], file},
    ]);
    expect(log).toEqual(['goto http://x/list?f=1', 'click #f', 'fill #q=a', 'wait .row', `shot ${file}`]);
  });

  test('a project without axe-core is told how to add it', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    try {
      loadAxeSource(root);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as UiInfrastructureError).category).toBe('axe-missing');
      expect((e as Error).message).toBe(AXE_HINT);
    }
  });

  test('the auditor injects axe into each page, returns its results and closes everything', async () => {
    const log: string[] = [];
    const results = {violations: [{id: 'color-contrast', impact: 'serious' as const, help: 'h', nodes: []}]};
    const fake = {
      chromium: {
        async launch() {
          return {
            async newContext(o: {viewport: {width: number; height: number}; colorScheme: string}) {
              log.push(`context ${o.viewport.width}x${o.viewport.height} ${o.colorScheme}`);
              return {
                async newPage() {
                  return {
                    async goto(url: string) {
                      log.push(`goto ${url}`);
                    },
                    async screenshot() {},
                    async addScriptTag(o: {content: string}) {
                      log.push(`inject ${o.content}`);
                    },
                    async evaluate(expression: string) {
                      log.push(`eval ${expression}`);
                      return results;
                    },
                  };
                },
                async close() {
                  log.push('close context');
                },
              };
            },
            async close() {
              log.push('close browser');
            },
          };
        },
      },
    };
    const request = {url: 'http://x/a', width: 10, height: 20, theme: 'light' as const};
    const audited = await playwrightAuditor('/unused', () => fake, () => 'AXE').audit([request]);
    expect(audited).toEqual([{request, results}]);
    expect(log).toEqual(['context 10x20 light', 'goto http://x/a', 'inject AXE', 'eval axe.run()', 'close context', 'close browser']);
  });

  function recordingFake(log: string[], opts: {slowStep?: boolean; noVideo?: boolean} = {}) {
    return {
      chromium: {
        async launch() {
          return {
            async newContext(o: {viewport: {width: number; height: number}; colorScheme: string; hasTouch?: boolean; recordVideo?: {dir: string; size: {width: number; height: number}}}) {
              log.push(`context ${o.viewport.width}x${o.viewport.height} touch=${o.hasTouch} video=${o.recordVideo?.size.width}x${o.recordVideo?.size.height}`);
              return {
                async newPage() {
                  return {
                    async goto(url: string) {
                      log.push(`goto ${url}`);
                    },
                    async screenshot() {},
                    async addScriptTag() {},
                    async evaluate() {},
                    async waitForSelector(s: string) {
                      log.push(`wait ${s}`);
                    },
                    async click(s: string) {
                      log.push(`click ${s}`);
                    },
                    async tap(s: string) {
                      log.push(`tap ${s}`);
                    },
                    async waitForTimeout(ms: number) {
                      log.push(`pause ${ms}`);
                      if (opts.slowStep) await new Promise(r => setTimeout(r, 5000));
                    },
                    keyboard: {
                      async press(k: string) {
                        log.push(`key ${k}`);
                      },
                    },
                    video: () => (opts.noVideo ? null : {async saveAs(path: string) { log.push(`save ${path}`); }}),
                  };
                },
                async close() {
                  log.push('close context');
                },
              };
            },
            async close() {
              log.push('close browser');
            },
          };
        },
      },
    };
  }

  test('the recorder plays each step in order on a video-recording context, saves the video after the context closes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    const log: string[] = [];
    const file = join(root, 'docs', 'screenshots', 'play.webm');
    await playwrightRecorder(root, () => recordingFake(log)).record({
      url: 'http://x/g',
      width: 10,
      height: 20,
      maxSeconds: 5,
      steps: [{wait: '#a'}, {click: '#a'}, {key: 'Space'}, {tap: '#b'}, {pause: 100}],
      file,
    });
    expect(log).toEqual(['context 10x20 touch=true video=10x20', 'goto http://x/g', 'wait #a', 'click #a', 'key Space', 'tap #b', 'pause 100', 'close context', `save ${file}`, 'close context', 'close browser']);
  });

  test('a script that outruns its maximum fails and still closes the browser', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    const log: string[] = [];
    const rec = playwrightRecorder(root, () => recordingFake(log, {slowStep: true}));
    await expect(rec.record({url: 'http://x/', width: 1, height: 1, maxSeconds: 0.05, steps: [{pause: 10}], file: join(root, 'a.webm')})).rejects.toThrow('maximum of 0.05 seconds');
    expect(log.at(-1)).toBe('close browser');
    expect(log.some(l => l.startsWith('save'))).toBe(false);
  });

  test('a context that recorded no video is an error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    const rec = playwrightRecorder(root, () => recordingFake([], {noVideo: true}));
    await expect(rec.record({url: 'http://x/', width: 1, height: 1, maxSeconds: 5, steps: [{pause: 1}], file: join(root, 'a.webm')})).rejects.toThrow('recorded no video');
  });

  test('the gif encoder reports a missing ffmpeg as false, success as true and a failing run as an error', async () => {
    expect(await ffmpegGifEncoder('forger-no-such-ffmpeg').encode('a.webm', 'a.gif')).toBe(false);
    expect(await ffmpegGifEncoder('true').encode('a.webm', 'a.gif')).toBe(true);
    await expect(ffmpegGifEncoder('false').encode('a.webm', 'a.gif')).rejects.toThrow('ffmpeg failed');
  });
});
