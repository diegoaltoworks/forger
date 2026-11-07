import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {deflateSync} from 'zlib';

import {UiInfrastructureError} from '../ports';
import {AXE_HINT, PLAYWRIGHT_HINT, ffmpegGifEncoder, loadAxeSource, loadPlaywright, playwrightAuditor, playwrightRecorder, playwrightScreenshotter, visibleClip} from './playwright';

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
                    on() {},
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
      on() {},
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

  test('a shot with a locale and dir opens the context in that locale and sets dir on the page root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    const log: string[] = [];
    const page = {
      async goto() { log.push('goto'); },
      async screenshot() { log.push('shot'); },
      on() {},
      async addScriptTag() {},
      async evaluate(e: string) { log.push(`eval ${e}`); },
    };
    const fake = {chromium: {async launch() {
      return {
        async newContext(o: {locale?: string}) { log.push(`locale ${o.locale}`); return {async newPage() { return page; }, async close() {}}; },
        async close() {},
      };
    }}};
    await playwrightScreenshotter(root, () => fake).capture([{url: 'http://x/', width: 1, height: 1, theme: 'light', locale: 'ar', dir: 'rtl', file: join(root, 'a.png')}]);
    expect(log).toEqual(['locale ar', 'goto', 'eval document.documentElement.dir = "rtl"', 'shot']);
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
                    on() {},
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
                    on() {},
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

describe('probing a page for assertions', () => {
  const sand = (): Uint8Array => {
    // 2x2 RGB PNG, every pixel (214, 160, 90)
    const row = [0, ...[214, 160, 90, 214, 160, 90]];
    const head = Buffer.alloc(13);
    head.writeUInt32BE(2, 0);
    head.writeUInt32BE(2, 4);
    head.set([8, 2, 0, 0, 0], 8);
    const chunk = (type: string, body: Uint8Array): Buffer => {
      const out = Buffer.alloc(12 + body.length);
      out.writeUInt32BE(body.length, 0);
      out.write(type, 4, 'ascii');
      out.set(body, 8);
      return out;
    };
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.from([...row, ...row]))), chunk('IEND', new Uint8Array())]);
  };

  test('visibleClip keeps the on-screen part of a box and refuses one that is off screen', () => {
    expect(visibleClip({x: -5.5, y: 10.2, width: 50, height: 400}, 100, 300)).toEqual({x: 0, y: 10, width: 45, height: 290});
    expect(visibleClip({x: 0, y: 320, width: 50, height: 40}, 100, 300)).toBeNull();
  });

  test('a shot with a probe resolves a page model of console errors, boxes and sampled pixels; one without resolves nothing for it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-pw-'));
    dirs.push(root);
    const handlers: Record<string, (arg: never) => void> = {};
    const clips: unknown[] = [];
    const fake = {
      chromium: {
        async launch() {
          return {
            async newContext() {
              return {
                async newPage() {
                  return {
                    on(event: string, h: (arg: never) => void) {
                      handlers[event] = h;
                    },
                    async goto() {
                      (handlers.console as (m: unknown) => void)({type: () => 'error', text: () => 'boom'});
                      (handlers.console as (m: unknown) => void)({type: () => 'log', text: () => 'fine'});
                      (handlers.pageerror as (e: unknown) => void)(new Error('uncaught'));
                    },
                    async screenshot(o: {clip?: unknown}) {
                      clips.push(o.clip);
                      return sand();
                    },
                    async addScriptTag() {},
                    async evaluate() {
                      return [{box: {x: 0, y: 0, width: 40, height: 20}, visible: true}, null];
                    },
                  };
                },
                async close() {},
              };
            },
            async close() {},
          };
        },
      },
    };
    const pages = await playwrightScreenshotter(root, () => fake as never).capture([
      {url: 'http://x/', width: 100, height: 100, theme: 'light', probe: {boxes: ['#a', '#b'], pixels: ['#a']}},
      {url: 'http://x/', width: 100, height: 100, theme: 'light'},
    ]);
    expect(pages).toHaveLength(2);
    expect(pages?.[0]).toEqual({
      viewport: {width: 100, height: 100},
      console: ['boom', 'uncaught'],
      elements: {
        '#a': {found: true, visible: true, box: {x: 0, y: 0, width: 40, height: 20}, pixels: [[214, 160, 90], [214, 160, 90], [214, 160, 90], [214, 160, 90]]},
        '#b': {found: false, visible: false, box: null, pixels: []},
      },
    });
    expect(pages?.[1]).toBeUndefined();
    expect(clips).toEqual([{x: 0, y: 0, width: 40, height: 20}]);
  });
});
