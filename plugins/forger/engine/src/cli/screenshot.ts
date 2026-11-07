import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';

import {execCapture, ffmpegGifEncoder, playwrightRecorder, playwrightScreenshotter, shellAppServer, staticAppServer} from '../adapters';
import {UiInfrastructureError} from '../ports';
import {BEFORE_SCRATCH, UI_PATH, UiConfigError, WireframeError, formatFailures, parseUiConfig, runBefore, runRecording, runScreenshots, wireframePlan} from '../ui';
import type {Command} from './command';
import {forgerPath} from '../config';

async function freePort(): Promise<number> {
  const probe = Bun.serve({port: 0, hostname: '127.0.0.1', fetch: () => new Response('')});
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

/** Captures the base branch from a detached worktree, which is removed again whatever happens. */
async function beforeAndAfter(config: ReturnType<typeof parseUiConfig>, projectRoot: string, base: string, shooter: ReturnType<typeof playwrightScreenshotter>) {
  const git = execCapture(projectRoot);
  const remote = git(`git rev-parse --verify --quiet origin/${base}`);
  const ref = remote.exitCode === 0 ? `origin/${base}` : base;
  const tree = join(mkdtempSync(join(tmpdir(), 'forger-before-')), 'base');
  const added = git(`git worktree add --detach "${tree}" ${ref}`);
  if (added.exitCode !== 0) throw new UiConfigError(`cannot check out ${ref} to capture the before images: ${added.stderr.trim()}`);
  try {
    const files = {
      read: (p: string) => (existsSync(join(projectRoot, p)) ? readFileSync(join(projectRoot, p)) : undefined),
      write: (p: string, bytes: Uint8Array) => {
        mkdirSync(dirname(join(projectRoot, p)), {recursive: true});
        writeFileSync(join(projectRoot, p), bytes);
      },
    };
    return await runBefore(config, projectRoot, shellAppServer(tree), shellAppServer(projectRoot), shooter, files);
  } finally {
    git(`git worktree remove --force "${tree}"`);
    rmSync(join(projectRoot, BEFORE_SCRATCH), {recursive: true, force: true});
  }
}

/** Exit 1 is a config the project must fix; exit 2 is an environment that cannot capture. */
export const screenshot: Command = {
  name: 'screenshot',
  needs: 'root',
  flags: ['json', 'wireframe', 'capture', 'before'],
  help: `  screenshot [--json] [--before] [--wireframe <ticket>] [--capture <name>]
                   Start the app (ui.start), capture every route and named state x viewport x theme into
                   docs/screenshots/, stop it (exit 2 when Playwright or the app is unavailable). A named state's assertions
                   run on each capture; a failure is named by state, viewport, theme and assertion and exits 1, the images still written.
                   Each locale declared in ui.json multiplies the captures and names the files by locale.
                   --before also captures the base branch in a worktree of its own and writes one side-by-side image
                   (before left, after right) per changed screen under docs/screenshots/compare/
                   --wireframe serves docs/design/ and captures <ticket>/index.html into docs/design/<ticket>/
                   --capture runs the scripted interaction declared under "captures" in ui.json and records it
                   as docs/screenshots/<name>.webm, plus a .gif when ffmpeg is installed (exit 2 with how to add it when not)`,
  async run(ctx) {
    const {values, projectRoot} = ctx;
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
      } else if (values.before) {
        if (values.wireframe !== undefined) return fail('--before and --wireframe cannot be combined', 1, false);
        report = await beforeAndAfter(config, projectRoot, ctx.config.base_branch, shooter);
      } else if (values.wireframe === undefined) {
        report = await runScreenshots(config, projectRoot, shellAppServer(projectRoot), shooter);
      } else {
        const port = await freePort();
        const plan = wireframePlan(config, values.wireframe, port);
        if (!existsSync(join(projectRoot, plan.root, plan.page))) return fail(`${plan.root}${plan.page} not found; write the wireframe first`, 1, false);
        report = await runScreenshots(plan.config, projectRoot, staticAppServer(join(projectRoot, plan.root), port), shooter, plan.dir);
      }
      console.log(values.json ? JSON.stringify(report) : report.files.join('\n'));
      if (!report.ok) {
        if (!values.json) console.error(formatFailures(report.failures));
        process.exitCode = 1;
      }
    } catch (e) {
      if (e instanceof UiInfrastructureError) return fail(e.message, 2, true);
      if (e instanceof UiConfigError || e instanceof WireframeError) return fail(e.message, 1, false);
      throw e;
    }
  },
};
