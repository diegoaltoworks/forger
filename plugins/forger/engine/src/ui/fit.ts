/**
 * How much room a piece of text has at its worst case: the target's captures
 * across viewports and locales, each at 100% and 200% text scale. Planning and
 * ranking are pure; the app and the browser arrive as ports.
 */

import type {AppServer, ElementFit, PageModel, Screenshotter, ShotRequest} from '../ports';
import {planCaptures, type Capture} from './plan';
import {UiConfigError, type UiConfig} from './ui-config';

export const TEXT_SCALES: readonly number[] = [1, 2];

export interface FitRow {
  viewport: string;
  locale?: string;
  /** Percent: 100 or 200. */
  scale: number;
  /** Which of the selector's matches, from 0. */
  element: number;
  textWidth: number;
  availableWidth: number;
  /** Room left on one line; negative when the text does not fit. */
  headroom: number;
  wraps: boolean;
  clipped: boolean;
}

export interface FitReport {
  target: string;
  selector: string;
  /** Worst case first: the least room, then clipped, then wrapped. */
  rows: FitRow[];
  /** False when any row wraps or is clipped. */
  fits: boolean;
}

interface FitShot {
  capture: Capture;
  scale: number;
  request: ShotRequest;
}

/** The captures a route or a named state yields, in the first theme only: text width does not depend on colour. */
export function fitTargets(config: UiConfig, target: string): Capture[] {
  const theme = config.themes[0];
  const found = planCaptures(config).filter(c => c.theme === theme && (c.state === undefined ? c.route === target : c.state === target));
  if (found.length === 0) {
    throw new UiConfigError(`"${target}" is neither a route nor a named state; the choices are ${[...config.routes, ...config.states.map(s => s.name)].join(', ') || 'none declared'}`);
  }
  return found;
}

export function planFits(captures: Capture[], selector: string, text?: string): FitShot[] {
  return captures.flatMap(capture =>
    TEXT_SCALES.map(scale => ({
      capture,
      scale,
      request: {
        url: capture.url,
        width: capture.width,
        height: capture.height,
        theme: capture.theme,
        ...(capture.locale !== undefined ? {locale: capture.locale, dir: capture.dir} : {}),
        ...(capture.steps !== undefined && capture.steps.length > 0 ? {steps: capture.steps} : {}),
        fit: {selector, scale, ...(text !== undefined ? {text} : {})},
      } satisfies ShotRequest,
    }))
  );
}

function rowOf(shot: FitShot, fit: ElementFit, element: number): FitRow {
  return {
    viewport: shot.capture.viewport,
    ...(shot.capture.locale !== undefined ? {locale: shot.capture.locale} : {}),
    scale: Math.round(shot.scale * 100),
    element,
    textWidth: fit.textWidth,
    availableWidth: fit.availableWidth,
    headroom: Math.round((fit.availableWidth - fit.textWidth) * 10) / 10,
    wraps: fit.wraps,
    clipped: fit.clipped,
  };
}

export function rankRows(rows: FitRow[]): FitRow[] {
  return [...rows].sort((a, b) => a.headroom - b.headroom || Number(b.clipped) - Number(a.clipped) || Number(b.wraps) - Number(a.wraps) || b.scale - a.scale);
}

export function buildFitReport(target: string, selector: string, shots: FitShot[], pages: Array<PageModel | undefined>): FitReport {
  const rows = shots.flatMap((shot, i) => (pages[i]?.fits ?? []).map((fit, element) => rowOf(shot, fit, element)));
  return {target, selector, rows: rankRows(rows), fits: rows.every(r => !r.wraps && !r.clipped)};
}

export function formatFitReport(report: FitReport): string {
  if (report.rows.length === 0) return `${report.target}: nothing matches ${report.selector}`;
  const lines = report.rows.map(r => {
    const where = `${r.viewport}${r.locale !== undefined ? `, ${r.locale}` : ''}, ${r.scale}%`;
    const state = r.clipped ? 'clipped' : r.wraps ? 'wraps' : 'fits';
    return `${where}: text ${r.textWidth}px of ${r.availableWidth}px available (${r.headroom >= 0 ? '+' : ''}${r.headroom}px), ${state}${report.rows.some(x => x.element > 0) ? `, match ${r.element}` : ''}`;
  });
  return [`${report.target} ${report.selector}: worst case first`, ...lines].join('\n');
}

/** The longest real string of a translation file: JSON of any nesting, else one string per line. */
export function longestString(raw: string): string {
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  try {
    walk(JSON.parse(raw));
  } catch {
    strings.push(...raw.split('\n').map(l => l.trim()).filter(l => l !== ''));
  }
  if (strings.length === 0) throw new UiConfigError('the text file holds no strings');
  return strings.reduce((a, b) => (b.length > a.length ? b : a));
}

export async function runFit(config: UiConfig, target: string, selector: string, server: AppServer, shooter: Screenshotter, text?: string): Promise<FitReport> {
  const shots = planFits(fitTargets(config, target), selector, text);
  let pages: Array<PageModel | undefined> = [];
  try {
    await server.start(config.start);
    await server.waitReady(config.url, config.ready_timeout * 1000);
    pages = (await shooter.capture(shots.map(s => s.request))) ?? [];
  } finally {
    await server.stop();
  }
  return buildFitReport(target, selector, shots, pages);
}
