/**
 * `check ui`: a branch that changes UI files also updates the screenshots that
 * show them. Pure over the parsed diff.
 */

import {SCREENSHOT_DIR, UI_PATH, type UiConfig} from '../../ui';
import type {FileChange} from '../decisions';
import type {Gap} from '../gaps';
import {globToRegExp, type Finding} from '../waivers';

export const UI_OPINION = 'ui.evidence';

const MEDIA = /\.(?:png|jpe?g|gif|webp|webm|mp4)(?:[?#]|$)/i;

/** Whether the PR body links an image or video kept on the configured screenshots branch. */
export function linksScreenshotsBranch(body: string, branch: string): boolean {
  const urls = body.match(/https?:\/\/[^\s)>\]"']+/g) ?? [];
  return urls.some(u => u.includes(`/${branch}/`) && MEDIA.test(u));
}

export function checkUiEvidence(changes: FileChange[], config: UiConfig, prBody = ''): Finding[] {
  const ui = config.paths.map(globToRegExp);
  const touched = changes.filter(c => !c.path.startsWith(SCREENSHOT_DIR) && ui.some(re => re.test(c.path)));
  if (touched.length === 0) return [];
  if (changes.some(c => c.status !== 'deleted' && c.path.startsWith(SCREENSHOT_DIR))) return [];
  if (config.screenshots_branch !== undefined && linksScreenshotsBranch(prBody, config.screenshots_branch)) return [];
  return [
    {
      file: touched[0].path,
      line: 1,
      rule: 'ui-without-screenshots',
      opinion: UI_OPINION,
      detail: `the branch changes UI files (${touched.length}) but adds or updates nothing under ${SCREENSHOT_DIR}${config.screenshots_branch !== undefined ? ` and the PR body links no image on the ${config.screenshots_branch} branch` : ''}; run screenshot`,
    },
  ];
}

export const NARROW_WIDTH = 360;

/** A SHOULD gap: no viewport is as narrow as a small phone, so the narrowest layout is never captured. */
export function narrowestViewportGaps(config: UiConfig): Gap[] {
  if (config.viewports.some(v => v.width <= NARROW_WIDTH)) return [];
  return [
    {
      file: UI_PATH,
      opinion: 'ui.narrowest-viewport',
      modality: 'SHOULD',
      detail: `no viewport is ${NARROW_WIDTH} px wide or less; add the narrowest width the project supports`,
    },
  ];
}
