import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {ffmpegGifEncoder, playwrightRecorder, playwrightScreenshotter, shellAppServer, staticAppServer} from '../adapters';
import {UiInfrastructureError} from '../ports';
import {UI_PATH, UiConfigError, WireframeError, parseUiConfig, runRecording, runScreenshots, wireframePlan} from '../ui';
import type {Command} from './command';
import {forgerPath} from '../config';

async function freePort(): Promise<number> {
  const probe = Bun.serve({port: 0, hostname: '127.0.0.1', fetch: () => new Response('')});
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

/** Exit 1 is a config the project must fix; exit 2 is an environment that cannot capture. */
export const screenshot: Command = {
  name: 'screenshot',
  needs: 'root',
  flags: ['json', 'wireframe', 'capture'],
  help: `  screenshot [--json] [--wireframe <ticket>] [--capture <name>]
                   Start the app (ui.start), capture every route and named state x viewport x theme into
                   docs/screenshots/, stop it (exit 2 when Playwright or the app is unavailable).
                   --wireframe serves docs/design/ and captures <ticket>/index.html into docs/design/<ticket>/
                   --capture runs the scripted interaction declared under "captures" in ui.json and records it
                   as docs/screenshots/<name>.webm, plus a .gif when ffmpeg is installed (exit 2 with how to add it when not)`,
  async run({values, projectRoot}) {
    const fail = (message: string, code: number, infrastructure: boolean): void => {
      console.error(values.json ? JSON.stringify({ok: false, infrastructure, error: message}) : message);
      process.exitCode = code;
    };
    const path = forgerPath(projectRoot, UI_PATH);
    if (!existsSync(path)) return fail(`${UI_PATH} not found; install the ui pack with setup`, 1, false);
    try {
      const config = parseUiConfig(readFileSync(path, 'utf-8'));
      const shooter = playwrightScreenshotter(projectRoot);
      let report;
      if (values.capture !== undefined) {
        if (values.wireframe !== undefined) return fail('--capture and --wireframe cannot be combined', 1, false);
        report = await runRecording(config, values.capture, projectRoot, shellAppServer(projectRoot), playwrightRecorder(projectRoot), ffmpegGifEncoder());
      } else if (values.wireframe === undefined) {
        report = await runScreenshots(config, projectRoot, shellAppServer(projectRoot), shooter);
      } else {
        const port = await freePort();
        const plan = wireframePlan(config, values.wireframe, port);
        if (!existsSync(join(projectRoot, plan.root, plan.page))) return fail(`${plan.root}${plan.page} not found; write the wireframe first`, 1, false);
        report = await runScreenshots(plan.config, projectRoot, staticAppServer(join(projectRoot, plan.root), port), shooter, plan.dir);
      }
      console.log(values.json ? JSON.stringify(report) : report.files.join('\n'));
    } catch (e) {
      if (e instanceof UiInfrastructureError) return fail(e.message, 2, true);
      if (e instanceof UiConfigError || e instanceof WireframeError) return fail(e.message, 1, false);
      throw e;
    }
  },
};
