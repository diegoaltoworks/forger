/**
 * The real `Screenshotter`, over the project's own Playwright. Forger does not
 * depend on Playwright: it resolves it from the project being captured, and a
 * project without it gets the command that adds it.
 */

import {spawn} from 'child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'fs';
import {createRequire} from 'module';
import {tmpdir} from 'os';
import {dirname, join} from 'path';

import {UiInfrastructureError, type AccessibilityAuditor, type AuditRequest, type AuditedPage, type AxeResults, type CaptureStep, type GifEncoder, type Recorder, type RecordRequest, type Screenshotter, type ShotRequest} from '../ports';

export const PLAYWRIGHT_HINT = 'Playwright is not installed in this project; add it with `bun add -d playwright && bunx playwright install chromium`';

interface PlaywrightPage {
  goto(url: string, opts: {waitUntil: 'networkidle'}): Promise<unknown>;
  screenshot(opts: {path: string; fullPage: boolean}): Promise<unknown>;
  addScriptTag(opts: {content: string}): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
}
/** What the recorder drives, on the same page object the screenshotter gets. */
interface RecordingPage extends PlaywrightPage {
  waitForSelector(selector: string): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  tap(selector: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<unknown>;
  keyboard: {press(key: string): Promise<unknown>};
  video?(): {saveAs(path: string): Promise<unknown>} | null;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightBrowser {
  newContext(opts: {viewport: {width: number; height: number}; colorScheme: 'light' | 'dark'; hasTouch?: boolean; recordVideo?: {dir: string; size: {width: number; height: number}}}): Promise<PlaywrightContext>;
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

export const AXE_HINT = 'axe-core is not installed in this project; add it with `bun add -d axe-core`';

/** The axe-core script the project has installed, to inject into a page. */
export function loadAxeSource(projectRoot: string): string {
  try {
    return (createRequire(join(projectRoot, 'package.json'))('axe-core') as {source: string}).source;
  } catch (e) {
    const code = (e as {code?: string}).code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') throw new UiInfrastructureError('axe-missing', AXE_HINT);
    throw e;
  }
}

async function launch(chromium: PlaywrightModule['chromium']): Promise<PlaywrightBrowser> {
  try {
    return await chromium.launch();
  } catch (e) {
    throw new UiInfrastructureError('playwright-missing', `Playwright could not start a browser (${(e as Error).message}); run \`bunx playwright install chromium\``);
  }
}

export function playwrightAuditor(
  projectRoot: string,
  load: (root: string) => PlaywrightModule = loadPlaywright,
  axeSource: (root: string) => string = loadAxeSource
): AccessibilityAuditor {
  return {
    async audit(requests: AuditRequest[]): Promise<AuditedPage[]> {
      const {chromium} = load(projectRoot);
      const source = axeSource(projectRoot);
      const browser = await launch(chromium);
      const audited: AuditedPage[] = [];
      try {
        for (const request of requests) {
          const context = await browser.newContext({viewport: {width: request.width, height: request.height}, colorScheme: request.theme});
          try {
            const page = await context.newPage();
            await page.goto(request.url, {waitUntil: 'networkidle'});
            await page.addScriptTag({content: source});
            audited.push({request, results: (await page.evaluate('axe.run()')) as AxeResults});
          } finally {
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
      return audited;
    },
  };
}

export function playwrightScreenshotter(projectRoot: string, load: (root: string) => PlaywrightModule = loadPlaywright): Screenshotter {
  return {
    async capture(shots: ShotRequest[]) {
      const {chromium} = load(projectRoot);
      const browser = await launch(chromium);
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

async function perform(page: RecordingPage, step: CaptureStep): Promise<void> {
  if ('wait' in step) await page.waitForSelector(step.wait);
  else if ('key' in step) await page.keyboard.press(step.key);
  else if ('click' in step) await page.click(step.click);
  else if ('tap' in step) await page.tap(step.tap);
  else await page.waitForTimeout(step.pause);
}

/**
 * Plays the steps on a page whose context records video. The recording is the
 * evidence, so a script that outruns its maximum fails rather than ships a
 * truncated or endless clip.
 */
export function playwrightRecorder(projectRoot: string, load: (root: string) => PlaywrightModule = loadPlaywright): Recorder {
  return {
    async record(request: RecordRequest) {
      const {chromium} = load(projectRoot);
      const browser = await launch(chromium);
      const scratch = mkdtempSync(join(tmpdir(), 'forger-video-'));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const size = {width: request.width, height: request.height};
        const context = await browser.newContext({viewport: size, colorScheme: 'light', hasTouch: true, recordVideo: {dir: scratch, size}});
        try {
          const page = (await context.newPage()) as RecordingPage;
          const script = (async () => {
            await page.goto(request.url, {waitUntil: 'networkidle'});
            for (const step of request.steps) await perform(page, step);
          })();
          const limit = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`the capture ran past its maximum of ${request.maxSeconds} seconds`)), request.maxSeconds * 1000);
          });
          script.catch(() => {});
          await Promise.race([script, limit]);
          const video = page.video?.();
          await context.close();
          if (video === undefined || video === null) throw new Error('Playwright recorded no video');
          mkdirSync(dirname(request.file), {recursive: true});
          await video.saveAs(request.file);
        } finally {
          await context.close().catch(() => {});
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await browser.close();
        rmSync(scratch, {recursive: true, force: true});
      }
    },
  };
}

/** GIF conversion through the project machine's own ffmpeg; its absence is reported, not thrown. */
export function ffmpegGifEncoder(bin = 'ffmpeg'): GifEncoder {
  return {
    encode(video, gif) {
      return new Promise((resolve, reject) => {
        const child = spawn(bin, ['-y', '-loglevel', 'error', '-i', video, '-vf', 'fps=12,scale=iw:-1:flags=lanczos', gif], {stdio: ['ignore', 'ignore', 'pipe']});
        let err = '';
        child.stderr.on('data', d => (err += String(d)));
        child.on('error', e => ((e as {code?: string}).code === 'ENOENT' ? resolve(false) : reject(e)));
        child.on('close', code => (code === 0 ? resolve(true) : reject(new Error(`ffmpeg failed (${code}): ${err.trim()}`))));
      });
    },
  };
}
