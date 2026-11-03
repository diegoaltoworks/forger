/**
 * `check ui`: a branch that changes UI files also updates the screenshots that
 * show them. Pure over the parsed diff.
 */

import {SCREENSHOT_DIR, type UiConfig} from '../../ui';
import type {FileChange} from '../decisions';
import {globToRegExp, type Finding} from '../waivers';

export const UI_OPINION = 'ui.evidence';

export function checkUiEvidence(changes: FileChange[], config: UiConfig): Finding[] {
  const ui = config.paths.map(globToRegExp);
  const touched = changes.filter(c => !c.path.startsWith(SCREENSHOT_DIR) && ui.some(re => re.test(c.path)));
  if (touched.length === 0) return [];
  if (changes.some(c => c.status !== 'deleted' && c.path.startsWith(SCREENSHOT_DIR))) return [];
  return [
    {
      file: touched[0].path,
      line: 1,
      rule: 'ui-without-screenshots',
      opinion: UI_OPINION,
      detail: `the branch changes UI files (${touched.length}) but adds or updates nothing under ${SCREENSHOT_DIR}; run screenshot`,
    },
  ];
}
