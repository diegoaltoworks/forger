/**
 * `check ui --states`: serves the app, loads every named state at every
 * viewport and theme, and turns each failed assertion into a finding that
 * names the state, the viewport, the theme and the assertion. It needs a
 * browser, so it runs on its own rather than inside the umbrella `check`.
 */

import type {AppServer, Screenshotter} from '../../ports';
import {runStateAssertions, type UiConfig} from '../../ui';
import type {Finding} from '../waivers';

export const STATES_OPINION = 'ui.assertions';

export async function runStatesCheck(config: UiConfig, server: AppServer, shooter: Screenshotter): Promise<Finding[]> {
  const failures = await runStateAssertions(config, server, shooter);
  return failures.map(f => ({file: f.state, line: 1, rule: f.assertion, opinion: STATES_OPINION, detail: `${f.detail} (${f.viewport}, ${f.theme})`}));
}
