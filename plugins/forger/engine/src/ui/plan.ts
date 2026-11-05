/**
 * The capture matrix: every route x viewport x theme, with the deterministic
 * file each lands in. Pure, so the same config always names the same files.
 */

import type {CaptureStep} from '../ports';
import type {StateAssertions} from './assertions';
import {SCREENSHOT_DIR, UiConfigError, type Theme, type UiConfig} from './ui-config';

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
  url: string;
  /** Repo-relative path of the image. */
  file: string;
}

/** The route as a file-name part: "/" is "index", "/a/b?x=1" is "a-b-x-1". */
export function routeSlug(route: string): string {
  const slug = route.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug === '' ? 'index' : slug;
}

export function captureFile(route: string, viewport: string, theme: Theme, dir: string = SCREENSHOT_DIR): string {
  return `${dir}${routeSlug(route)}-${viewport}-${theme}.png`;
}

export function planCaptures(config: UiConfig, dir: string = SCREENSHOT_DIR): Capture[] {
  const plan: Capture[] = [];
  for (const route of config.routes) {
    for (const v of config.viewports) {
      for (const theme of config.themes) {
        plan.push({
          route,
          viewport: v.name,
          width: v.width,
          height: v.height,
          theme,
          url: `${config.url}${route}`,
          file: captureFile(route, v.name, theme, dir),
        });
      }
    }
  }
  for (const state of config.states) {
    for (const v of config.viewports) {
      for (const theme of config.themes) {
        plan.push({
          route: state.route,
          state: state.name,
          steps: state.steps,
          assert: state.assert,
          viewport: v.name,
          width: v.width,
          height: v.height,
          theme,
          url: `${config.url}${state.route}`,
          file: captureFile(state.name, v.name, theme, dir),
        });
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
