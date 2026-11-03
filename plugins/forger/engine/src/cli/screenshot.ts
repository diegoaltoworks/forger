import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {playwrightScreenshotter, shellAppServer} from '../adapters';
import {UiInfrastructureError} from '../ports';
import {UI_PATH, UiConfigError, parseUiConfig, runScreenshots} from '../ui';
import type {Command} from './command';

/** Exit 1 is a config the project must fix; exit 2 is an environment that cannot capture. */
export const screenshot: Command = {
  name: 'screenshot',
  needs: 'root',
  flags: ['json'],
  help: `  screenshot [--json]
                   Start the app (ui.start), capture every route x viewport x theme into
                   docs/screenshots/, stop it (exit 2 when Playwright or the app is unavailable)`,
  async run({values, projectRoot}) {
    const fail = (message: string, code: number, infrastructure: boolean): void => {
      console.error(values.json ? JSON.stringify({ok: false, infrastructure, error: message}) : message);
      process.exitCode = code;
    };
    const path = join(projectRoot, UI_PATH);
    if (!existsSync(path)) return fail(`${UI_PATH} not found; install the ui pack with setup`, 1, false);
    try {
      const report = await runScreenshots(parseUiConfig(readFileSync(path, 'utf-8')), projectRoot, shellAppServer(projectRoot), playwrightScreenshotter(projectRoot));
      console.log(values.json ? JSON.stringify(report) : report.files.join('\n'));
    } catch (e) {
      if (e instanceof UiInfrastructureError) return fail(e.message, 2, true);
      if (e instanceof UiConfigError) return fail(e.message, 1, false);
      throw e;
    }
  },
};
