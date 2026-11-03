/**
 * The real `Screenshotter`, over the project's own Playwright. Forger does not
 * depend on Playwright: it resolves it from the project being captured, and a
 * project without it gets the command that adds it.
 */

import {mkdirSync} from 'fs';
import {createRequire} from 'module';
import {dirname, join} from 'path';

import {UiInfrastructureError, type Screenshotter, type ShotRequest} from '../ports';

export const PLAYWRIGHT_HINT = 'Playwright is not installed in this project; add it with `bun add -d playwright && bunx playwright install chromium`';

interface PlaywrightPage {
  goto(url: string, opts: {waitUntil: 'networkidle'}): Promise<unknown>;
  screenshot(opts: {path: string; fullPage: boolean}): Promise<unknown>;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightBrowser {
  newContext(opts: {viewport: {width: number; height: number}; colorScheme: 'light' | 'dark'}): Promise<PlaywrightContext>;
  close(): Promise<void>;
}
interface PlaywrightModule {
  chromium: {launch(): Promise<PlaywrightBrowser>};
}

export function loadPlaywright(projectRoot: string): PlaywrightModule {
  try {
    return createRequire(join(projectRoot, 'package.json'))('playwright') as PlaywrightModule;
  } catch (e) {
    const code = (e as {code?: string}).code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') throw new UiInfrastructureError('playwright-missing', PLAYWRIGHT_HINT);
    throw e;
  }
}

export function playwrightScreenshotter(projectRoot: string, load: (root: string) => PlaywrightModule = loadPlaywright): Screenshotter {
  return {
    async capture(shots: ShotRequest[]) {
      const {chromium} = load(projectRoot);
      let browser: PlaywrightBrowser;
      try {
        browser = await chromium.launch();
      } catch (e) {
        throw new UiInfrastructureError('playwright-missing', `Playwright could not start a browser (${(e as Error).message}); run \`bunx playwright install chromium\``);
      }
      try {
        for (const shot of shots) {
          mkdirSync(dirname(shot.file), {recursive: true});
          const context = await browser.newContext({viewport: {width: shot.width, height: shot.height}, colorScheme: shot.theme});
          try {
            const page = await context.newPage();
            await page.goto(shot.url, {waitUntil: 'networkidle'});
            await page.screenshot({path: shot.file, fullPage: true});
          } finally {
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    },
  };
}
