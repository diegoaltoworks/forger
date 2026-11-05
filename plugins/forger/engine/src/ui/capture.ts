/**
 * Runs the capture matrix against a served app. The app and the browser arrive
 * as ports, so the order of events - start, wait, capture, stop - is tested
 * with fakes. The app is always stopped, including when a step fails.
 */

import {join} from 'path';

import type {AppServer, PageModel, Screenshotter, ShotRequest} from '../ports';
import {evaluateAssertions, probeFor} from './assertions';
import {planCaptures, type Capture} from './plan';
import type {UiConfig} from './ui-config';

/** One assertion a state failed at one viewport and theme. */
export interface StateFailure {
  state: string;
  viewport: string;
  theme: string;
  assertion: string;
  detail: string;
}

export interface ScreenshotReport {
  /** False when a state's assertion failed; the images are written either way. */
  ok: boolean;
  files: string[];
  captures: Capture[];
  failures: StateFailure[];
}

function request(c: Capture, projectRoot: string, withFile: boolean): ShotRequest {
  return {
    url: c.url,
    width: c.width,
    height: c.height,
    theme: c.theme,
    ...(c.steps !== undefined && c.steps.length > 0 ? {steps: c.steps} : {}),
    ...(withFile ? {file: join(projectRoot, c.file)} : {}),
    ...(c.assert !== undefined ? {probe: probeFor(c.assert)} : {}),
  };
}

/** Evaluates each state capture against the page the browser reported for it, in order. */
export function stateFailures(captures: Capture[], pages: Array<PageModel | undefined>): StateFailure[] {
  const out: StateFailure[] = [];
  captures.forEach((c, i) => {
    const page = pages[i];
    if (c.state === undefined || c.assert === undefined || page === undefined) return;
    for (const f of evaluateAssertions(c.assert, page)) out.push({state: c.state, viewport: c.viewport, theme: c.theme, ...f});
  });
  return out;
}

export function formatFailures(failures: StateFailure[]): string {
  return failures.map(f => `state "${f.state}" at ${f.viewport}, ${f.theme}: ${f.assertion}: ${f.detail}`).join('\n');
}

export async function runScreenshots(
  config: UiConfig,
  projectRoot: string,
  server: AppServer,
  shooter: Screenshotter,
  dir?: string
): Promise<ScreenshotReport> {
  const captures = planCaptures(config, dir);
  let pages: Array<PageModel | undefined> = [];
  try {
    await server.start(config.start);
    await server.waitReady(config.url, config.ready_timeout * 1000);
    pages = (await shooter.capture(captures.map(c => request(c, projectRoot, true)))) ?? [];
  } finally {
    await server.stop();
  }
  const failures = stateFailures(captures, pages);
  return {ok: failures.length === 0, files: captures.map(c => c.file), captures, failures};
}

/** Loads every state that declares assertions, writes no image and reports what failed. */
export async function runStateAssertions(config: UiConfig, server: AppServer, shooter: Screenshotter): Promise<StateFailure[]> {
  const captures = planCaptures(config).filter(c => c.state !== undefined);
  let pages: Array<PageModel | undefined> = [];
  try {
    await server.start(config.start);
    await server.waitReady(config.url, config.ready_timeout * 1000);
    pages = (await shooter.capture(captures.map(c => request(c, '', false)))) ?? [];
  } finally {
    await server.stop();
  }
  return stateFailures(captures, pages);
}
