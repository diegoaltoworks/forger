/**
 * The capture matrix: every route x viewport x theme, with the deterministic
 * file each lands in. Pure, so the same config always names the same files.
 */

import {SCREENSHOT_DIR, UiConfigError, type Theme, type UiConfig} from './ui-config';

export interface Capture {
  route: string;
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

export function captureFile(route: string, viewport: string, theme: Theme): string {
  return `${SCREENSHOT_DIR}${routeSlug(route)}-${viewport}-${theme}.png`;
}

export function planCaptures(config: UiConfig): Capture[] {
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
          file: captureFile(route, v.name, theme),
        });
      }
    }
  }
  const seen = new Map<string, string>();
  for (const c of plan) {
    const prior = seen.get(c.file);
    if (prior !== undefined && prior !== c.route) {
      throw new UiConfigError(`routes "${prior}" and "${c.route}" both write ${c.file}; rename one`);
    }
    seen.set(c.file, c.route);
  }
  return plan;
}

/** The route a captured url came from: the url without the app's base. */
export function routeOf(url: string, base: string): string {
  return url.startsWith(base) ? url.slice(base.length) || '/' : url;
}
