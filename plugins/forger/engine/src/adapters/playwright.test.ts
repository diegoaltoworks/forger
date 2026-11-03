import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {UiInfrastructureError} from '../ports';
import {PLAYWRIGHT_HINT, loadPlaywright, playwrightScreenshotter} from './playwright';

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
});
