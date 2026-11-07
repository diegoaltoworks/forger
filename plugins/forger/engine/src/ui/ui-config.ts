/**
 * The ui pack's config, parsed once at the boundary: a bad shape is an error,
 * never a quiet default. Pure.
 */

import type {CaptureStep} from '../ports';
import {parseAssertions, type StateAssertions} from './assertions';
import {DEFAULT_TOLERANCE, type Tolerance} from './compare';

export const UI_PATH = '.forger/ui.json';
export const SCREENSHOT_DIR = 'docs/screenshots/';

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export type Theme = 'light' | 'dark';

/** A named screen state that is not its own route: a route (query string allowed) and the steps that reach it. */
export interface UiState {
  name: string;
  route: string;
  steps: CaptureStep[];
  /** Mechanical checks `screenshot` runs at every viewport and theme. */
  assert: StateAssertions;
}

/** A named, scripted interaction recorded as video: motion, feedback and pacing that a still hides. */
export interface CaptureSpec {
  name: string;
  route: string;
  /** Name of one of the config's viewports. */
  viewport: string;
  steps: CaptureStep[];
  /** The longest the recording may run, in seconds. */
  max_seconds: number;
}

/** A language the app is captured in, and how the app is switched to it. */
export interface Locale {
  /** A language tag such as "en" or "ar"; it is part of the image file names. */
  code: string;
  dir: 'ltr' | 'rtl';
  /** A query parameter the app reads to pick the language: `?<param>=<code>` is added to every url. */
  param?: string;
  /** Steps run before a capture's own steps, for an app switched by a control instead. */
  steps: CaptureStep[];
}

export interface UiConfig {
  /** Globs of files that count as UI. */
  paths: string[];
  /** Globs of the files that define colours; raw colour literals are allowed only there. */
  tokens: string[];
  /** The command that serves the app. */
  start: string;
  /** Where the served app answers. */
  url: string;
  routes: string[];
  /** Named states captured like routes, after their steps; empty when the file declares none. */
  states: UiState[];
  viewports: Viewport[];
  themes: Theme[];
  /** Languages every route and state is captured in; empty means one capture in the app's own language. */
  locales: Locale[];
  /** Seconds to wait for the app to answer. */
  ready_timeout: number;
  /** How far a capture may drift from its approved baseline before `check ui` fails. */
  tolerance: Tolerance;
  /** Scripted interactions for `screenshot --capture`; empty when the file declares none. */
  captures: CaptureSpec[];
}

export class UiConfigError extends Error {
  constructor(problem: string) {
    super(`${UI_PATH}: ${problem}`);
  }
}

export const DEFAULT_VIEWPORTS: Viewport[] = [
  {name: 'phone', width: 390, height: 844},
  {name: 'desktop', width: 1280, height: 800},
];
export const DEFAULT_THEMES: Theme[] = ['light', 'dark'];

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function strings(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.some(s => typeof s !== 'string' || s.trim() === '')) {
    throw new UiConfigError(`"${name}" must be a non-empty list of non-empty strings`);
  }
  return (v as string[]).map(s => s.trim());
}

function text(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new UiConfigError(`"${name}" must be a non-empty string`);
  return v.trim();
}

function viewport(v: unknown, i: number): Viewport {
  const where = `viewports[${i}]`;
  if (typeof v !== 'object' || v === null) throw new UiConfigError(`${where} must be an object`);
  const o = v as Record<string, unknown>;
  const name = text(o.name, `${where}.name`);
  if (!NAME.test(name)) throw new UiConfigError(`${where}.name must be lowercase words joined by hyphens`);
  for (const k of ['width', 'height'] as const) {
    if (!Number.isInteger(o[k]) || (o[k] as number) <= 0) throw new UiConfigError(`${where}.${k} must be a positive integer`);
  }
  return {name, width: o.width as number, height: o.height as number};
}

export const DEFAULT_CAPTURE_SECONDS = 15;
const STEP_KINDS = ['wait', 'key', 'click', 'tap', 'pause', 'fill'] as const;

function step(v: unknown, where: string): CaptureStep {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new UiConfigError(`${where} must be an object`);
  const keys = Object.keys(v);
  if (keys.length !== 1 || !(STEP_KINDS as readonly string[]).includes(keys[0])) {
    throw new UiConfigError(`${where} must have exactly one of ${STEP_KINDS.join(', ')}`);
  }
  const kind = keys[0] as (typeof STEP_KINDS)[number];
  const value = (v as Record<string, unknown>)[kind];
  if (kind === 'pause') {
    if (!Number.isInteger(value) || (value as number) <= 0) throw new UiConfigError(`${where}.pause must be a positive integer of milliseconds`);
    return {pause: value as number};
  }
  if (kind === 'fill') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UiConfigError(`${where}.fill must be an object with selector and value`);
    const f = value as Record<string, unknown>;
    if (typeof f.value !== 'string') throw new UiConfigError(`${where}.fill.value must be a string`);
    return {fill: {selector: text(f.selector, `${where}.fill.selector`), value: f.value}};
  }
  return {[kind]: text(value, `${where}.${kind}`)} as CaptureStep;
}

function locale(v: unknown, i: number): Locale {
  const where = `locales[${i}]`;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new UiConfigError(`${where} must be an object`);
  const o = v as Record<string, unknown>;
  const code = text(o.code, `${where}.code`);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(code)) throw new UiConfigError(`${where}.code must be a language tag such as "en" or "ar-EG"`);
  if (o.dir !== 'ltr' && o.dir !== 'rtl') throw new UiConfigError(`${where}.dir must be ltr or rtl`);
  if (o.steps !== undefined && !Array.isArray(o.steps)) throw new UiConfigError(`${where}.steps must be a list`);
  const steps = ((o.steps as unknown[] | undefined) ?? []).map((s, j) => step(s, `${where}.steps[${j}]`));
  const param = o.param === undefined ? undefined : text(o.param, `${where}.param`);
  if (param === undefined && steps.length === 0) throw new UiConfigError(`${where} needs a param or steps to switch the app to "${code}"`);
  return {code, dir: o.dir, ...(param !== undefined ? {param} : {}), steps};
}

function tolerance(v: unknown): Tolerance {
  if (v === undefined) return DEFAULT_TOLERANCE;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new UiConfigError('"tolerance" must be an object');
  const o = v as Record<string, unknown>;
  const pixel = o.pixel === undefined ? DEFAULT_TOLERANCE.pixel : o.pixel;
  const area = o.area === undefined ? DEFAULT_TOLERANCE.area : o.area;
  if (!Number.isInteger(pixel) || (pixel as number) < 0 || (pixel as number) > 255) throw new UiConfigError('"tolerance.pixel" must be an integer from 0 to 255');
  if (typeof area !== 'number' || area < 0 || area > 1) throw new UiConfigError('"tolerance.area" must be a number from 0 to 1');
  return {pixel: pixel as number, area};
}

function captureSpec(v: unknown, i: number, viewports: Viewport[]): CaptureSpec {
  const where = `captures[${i}]`;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new UiConfigError(`${where} must be an object`);
  const o = v as Record<string, unknown>;
  const name = text(o.name, `${where}.name`);
  if (!NAME.test(name)) throw new UiConfigError(`${where}.name must be lowercase words joined by hyphens`);
  const route = o.route === undefined ? '/' : text(o.route, `${where}.route`);
  if (!route.startsWith('/')) throw new UiConfigError(`${where}.route "${route}" must start with "/"`);
  const viewport = o.viewport === undefined ? viewports[0].name : text(o.viewport, `${where}.viewport`);
  if (!viewports.some(x => x.name === viewport)) throw new UiConfigError(`${where}.viewport "${viewport}" is not one of the declared viewports`);
  if (!Array.isArray(o.steps) || o.steps.length === 0) throw new UiConfigError(`${where}.steps must be a non-empty list`);
  const steps = o.steps.map((s, j) => step(s, `${where}.steps[${j}]`));
  const max = o.max_seconds === undefined ? DEFAULT_CAPTURE_SECONDS : o.max_seconds;
  if (!Number.isInteger(max) || (max as number) <= 0) throw new UiConfigError(`${where}.max_seconds must be a positive integer`);
  const paused = steps.reduce((sum, s) => sum + ('pause' in s ? s.pause : 0), 0);
  if (paused > (max as number) * 1000) throw new UiConfigError(`${where} pauses for ${paused} ms, more than its max_seconds`);
  return {name, route, viewport, steps, max_seconds: max as number};
}

function uiState(v: unknown, i: number): UiState {
  const where = `states[${i}]`;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new UiConfigError(`${where} must be an object`);
  const o = v as Record<string, unknown>;
  const name = text(o.name, `${where}.name`);
  if (!NAME.test(name)) throw new UiConfigError(`${where}.name must be lowercase words joined by hyphens`);
  const route = o.route === undefined ? '/' : text(o.route, `${where}.route`);
  if (!route.startsWith('/')) throw new UiConfigError(`${where}.route "${route}" must start with "/"`);
  if (o.steps !== undefined && !Array.isArray(o.steps)) throw new UiConfigError(`${where}.steps must be a list`);
  const steps = ((o.steps as unknown[] | undefined) ?? []).map((s, j) => step(s, `${where}.steps[${j}]`));
  const assert = parseAssertions(o.assert, `${where}.assert`, m => {
    throw new UiConfigError(m);
  });
  return {name, route, steps, assert};
}

export function parseUiConfig(raw: string): UiConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UiConfigError('is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new UiConfigError('must be an object');
  const o = parsed as Record<string, unknown>;

  const routes = o.routes === undefined ? ['/'] : strings(o.routes, 'routes');
  for (const r of routes) if (!r.startsWith('/')) throw new UiConfigError(`route "${r}" must start with "/"`);

  const viewports = o.viewports === undefined ? DEFAULT_VIEWPORTS : (Array.isArray(o.viewports) ? o.viewports : []).map(viewport);
  if (viewports.length === 0) throw new UiConfigError('"viewports" must be a non-empty list');
  const viewportNames = viewports.map(v => v.name);
  if (new Set(viewportNames).size !== viewportNames.length) throw new UiConfigError('"viewports" names must be unique');

  const themes = o.themes === undefined ? DEFAULT_THEMES : strings(o.themes, 'themes');
  for (const t of themes) if (t !== 'light' && t !== 'dark') throw new UiConfigError(`theme "${t}" must be light or dark`);
  if (new Set(themes).size !== themes.length) throw new UiConfigError('"themes" must be unique');

  const url = o.url === undefined ? 'http://localhost:3000' : text(o.url, 'url');
  if (!/^https?:\/\//.test(url)) throw new UiConfigError('"url" must start with http:// or https://');

  const timeout = o.ready_timeout === undefined ? 60 : o.ready_timeout;
  if (!Number.isInteger(timeout) || (timeout as number) <= 0) throw new UiConfigError('"ready_timeout" must be a positive integer of seconds');

  if (o.captures !== undefined && !Array.isArray(o.captures)) throw new UiConfigError('"captures" must be a list');
  const captures = ((o.captures as unknown[] | undefined) ?? []).map((c, i) => captureSpec(c, i, viewports));
  if (o.states !== undefined && !Array.isArray(o.states)) throw new UiConfigError('"states" must be a list');
  const states = ((o.states as unknown[] | undefined) ?? []).map(uiState);
  const stateNames = states.map(s => s.name);
  if (new Set(stateNames).size !== stateNames.length) throw new UiConfigError('"states" names must be unique');

  if (o.locales !== undefined && !Array.isArray(o.locales)) throw new UiConfigError('"locales" must be a list');
  const locales = ((o.locales as unknown[] | undefined) ?? []).map(locale);
  if (new Set(locales.map(l => l.code.toLowerCase())).size !== locales.length) throw new UiConfigError('"locales" codes must be unique');

  const captureNames = captures.map(c => c.name);
  if (new Set(captureNames).size !== captureNames.length) throw new UiConfigError('"captures" names must be unique');

  return {
    paths: strings(o.paths, 'paths'),
    tokens: o.tokens === undefined ? [] : strings(o.tokens, 'tokens'),
    start: text(o.start, 'start'),
    url: url.replace(/\/+$/, ''),
    routes,
    states,
    viewports,
    themes: themes as Theme[],
    locales,
    ready_timeout: timeout as number,
    tolerance: tolerance(o.tolerance),
    captures,
  };
}
