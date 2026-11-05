/**
 * Runs the capture matrix against a served app. The app and the browser arrive
 * as ports, so the order of events - start, wait, capture, stop - is tested
 * with fakes. The app is always stopped, including when a step fails.
 */

import {join} from 'path';

import type {AppServer, Screenshotter} from '../ports';
import {planCaptures, type Capture} from './plan';
import type {UiConfig} from './ui-config';

export interface ScreenshotReport {
  ok: true;
  files: string[];
  captures: Capture[];
}

export async function runScreenshots(
  config: UiConfig,
  projectRoot: string,
  server: AppServer,
  shooter: Screenshotter,
  dir?: string
): Promise<ScreenshotReport> {
  const captures = planCaptures(config, dir);
  try {
    await server.start(config.start);
    await server.waitReady(config.url, config.ready_timeout * 1000);
    await shooter.capture(
      captures.map(c => ({url: c.url, width: c.width, height: c.height, theme: c.theme, ...(c.steps !== undefined && c.steps.length > 0 ? {steps: c.steps} : {}), file: join(projectRoot, c.file)}))
    );
  } finally {
    await server.stop();
  }
  return {ok: true, files: captures.map(c => c.file), captures};
}
