/**
 * The I/O half of `check a11y`: serves the app, audits every route at every
 * viewport and theme, and always stops the app. It needs a browser, so it runs
 * on its own rather than inside the umbrella `check`.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {AccessibilityAuditor, AppServer} from '../../ports';
import {UI_PATH, parseUiConfig, planCaptures, type UiConfig} from '../../ui';
import type {Finding} from '../waivers';
import {axeFindings} from './a11y';
import {forgerPath} from '../../config';

export async function runA11y(config: UiConfig, server: AppServer, auditor: AccessibilityAuditor): Promise<Finding[]> {
  const pages = planCaptures(config).map(c => ({url: c.url, width: c.width, height: c.height, theme: c.theme}));
  try {
    await server.start(config.start);
    await server.waitReady(config.url, config.ready_timeout * 1000);
    return axeFindings(await auditor.audit(pages), config.url);
  } finally {
    await server.stop();
  }
}

export function loadUiConfig(projectRoot: string): UiConfig {
  const path = forgerPath(projectRoot, UI_PATH);
  if (!existsSync(path)) throw new Error(`${UI_PATH} not found; the ui pack's config is required`);
  return parseUiConfig(readFileSync(path, 'utf-8'));
}
