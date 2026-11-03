/**
 * The ui pack's config, parsed once at the boundary: a bad shape is an error,
 * never a quiet default. Pure.
 */

export const UI_PATH = '.claude/ui.json';
export const SCREENSHOT_DIR = 'docs/screenshots/';

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export type Theme = 'light' | 'dark';

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
  viewports: Viewport[];
  themes: Theme[];
  /** Seconds to wait for the app to answer. */
  ready_timeout: number;
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

  return {
    paths: strings(o.paths, 'paths'),
    tokens: o.tokens === undefined ? [] : strings(o.tokens, 'tokens'),
    start: text(o.start, 'start'),
    url: url.replace(/\/+$/, ''),
    routes,
    viewports,
    themes: themes as Theme[],
    ready_timeout: timeout as number,
  };
}
