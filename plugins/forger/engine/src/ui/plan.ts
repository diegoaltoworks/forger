/**
 * The capture matrix: every route x viewport x theme, with the deterministic
 * file each lands in. Pure, so the same config always names the same files.
 */

import type {CaptureStep} from '../ports';
import type {StateAssertions} from './assertions';
import {SCREENSHOT_DIR, UiConfigError, type Locale, type Theme, type UiConfig, type UiState} from './ui-config';

export interface Capture {
  /** The route's path, or the state's name. */
  route: string;
  /** Set for a named state: the route it loads is in `url`. */
  state?: string;
  steps?: CaptureStep[];
  /** Set for a named state. */
  assert?: StateAssertions;
  viewport: string;
  width: number;
  height: number;
  theme: Theme;
  /** Set when the config declares locales: the language tag, and the writing direction the page runs with. */
  locale?: string;
  dir?: 'ltr' | 'rtl';
  url: string;
  /** Repo-relative path of the image. */
  file: string;
}

/** The route as a file-name part: "/" is "index", "/a/b?x=1" is "a-b-x-1". */
export function routeSlug(route: string): string {
  const slug = route.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug === '' ? 'index' : slug;
}

export function captureFile(route: string, viewport: string, theme: Theme, dir: string = SCREENSHOT_DIR, locale?: string): string {
  return `${dir}${routeSlug(route)}${locale === undefined ? '' : `-${locale.toLowerCase()}`}-${viewport}-${theme}.png`;
}

function localeUrl(url: string, locale: Locale | undefined): string {
  if (locale?.param === undefined) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(locale.param)}=${encodeURIComponent(locale.code)}`;
}

export function planCaptures(config: UiConfig, dir: string = SCREENSHOT_DIR): Capture[] {
  const plan: Capture[] = [];
  const locales: Array<Locale | undefined> = config.locales.length === 0 ? [undefined] : config.locales;
  const targets = [
    ...config.routes.map(route => ({route, name: route, state: undefined as UiState | undefined})),
    ...config.states.map(state => ({route: state.route, name: state.name, state})),
  ];
  for (const target of targets) {
    for (const locale of locales) {
      for (const v of config.viewports) {
        for (const theme of config.themes) {
          const steps = [...(locale?.steps ?? []), ...(target.state?.steps ?? [])];
          plan.push({
            route: target.route,
            ...(target.state !== undefined ? {state: target.state.name, assert: target.state.assert} : {}),
            ...(steps.length > 0 ? {steps} : {}),
            viewport: v.name,
            width: v.width,
            height: v.height,
            theme,
            ...(locale !== undefined ? {locale: locale.code, dir: locale.dir} : {}),
            url: localeUrl(`${config.url}${target.route}`, locale),
            file: captureFile(target.name, v.name, theme, dir, locale?.code),
          });
        }
      }
    }
  }
  const label = (c: Capture): string => (c.state === undefined ? `route "${c.route}"` : `state "${c.state}"`);
  const seen = new Map<string, string>();
  for (const c of plan) {
    const prior = seen.get(c.file);
    if (prior !== undefined && prior !== label(c)) {
      throw new UiConfigError(`${prior} and ${label(c)} both write ${c.file}; rename one`);
    }
    seen.set(c.file, label(c));
  }
  return plan;
}

/** The route a captured url came from: the url without the app's base. */
export function routeOf(url: string, base: string): string {
  return url.startsWith(base) ? url.slice(base.length) || '/' : url;
}
