import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';

import {shellAppServer} from '../adapters';
import {UiInfrastructureError, type Screenshotter} from '../ports';
import {runScreenshots} from './capture';
import {parseUiConfig} from './ui-config';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const SERVER = `
const dir = process.argv[2];
Bun.serve({
  port: Number(process.argv[3]),
  async fetch(req) {
    const name = new URL(req.url).pathname.replace(/^\\/+|\\/+$/g, '') || 'index';
    const file = Bun.file(dir + '/' + name + '.html');
    return (await file.exists()) ? new Response(file, {headers: {'content-type': 'text/html'}}) : new Response('missing', {status: 404});
  },
});
`;

function freePort(): number {
  const s = Bun.serve({port: 0, fetch: () => new Response('')});
  const port = s.port as number;
  s.stop(true);
  return port;
}

function site(): {root: string; port: number} {
  const root = mkdtempSync(join(tmpdir(), 'forger-site-'));
  dirs.push(root);
  mkdirSync(join(root, 'site'));
  writeFileSync(join(root, 'site', 'index.html'), '<h1>home</h1>');
  writeFileSync(join(root, 'site', 'about.html'), '<h1>about</h1>');
  writeFileSync(join(root, 'serve.ts'), SERVER);
  return {root, port: freePort()};
}

/** Stands in for the browser: writes what the served page said, so a file proves the app was really up. */
const pageWriter: Screenshotter = {
  async capture(shots) {
    for (const s of shots) {
      const body = await (await fetch(s.url)).text();
      mkdirSync(dirname(s.file), {recursive: true});
      writeFileSync(s.file, `${body}|${s.width}x${s.height}|${s.theme}`);
    }
  },
};

describe('screenshot against a fixture static site', () => {
  test('serves the site, writes every planned file, and stops the app', async () => {
    const {root, port} = site();
    const config = parseUiConfig(
      JSON.stringify({paths: ['site/**'], start: `bun serve.ts site ${port}`, url: `http://127.0.0.1:${port}`, routes: ['/', '/about'], ready_timeout: 20})
    );
    const report = await runScreenshots(config, root, shellAppServer(root), pageWriter);

    expect(report.files).toHaveLength(8);
    expect(readFileSync(join(root, 'docs/screenshots/index-phone-light.png'), 'utf-8')).toBe('<h1>home</h1>|390x844|light');
    expect(readFileSync(join(root, 'docs/screenshots/about-desktop-dark.png'), 'utf-8')).toBe('<h1>about</h1>|1280x800|dark');
    for (const f of report.files) expect(existsSync(join(root, f))).toBe(true);
    await expect(fetch(`http://127.0.0.1:${port}/`, {signal: AbortSignal.timeout(1000)})).rejects.toThrow();
  });

  test('an app that exits before answering is an infrastructure error carrying its output', async () => {
    const {root, port} = site();
    const config = parseUiConfig(JSON.stringify({paths: ['a'], start: 'echo boom >&2; exit 3', url: `http://127.0.0.1:${port}`, ready_timeout: 20}));
    const err = await runScreenshots(config, root, shellAppServer(root), pageWriter).catch(e => e);
    expect(err).toBeInstanceOf(UiInfrastructureError);
    expect(err.message).toContain('boom');
    expect(existsSync(join(root, 'docs'))).toBe(false);
  });

  test('an app that never answers times out and is stopped', async () => {
    const {root, port} = site();
    const config = parseUiConfig(JSON.stringify({paths: ['a'], start: 'sleep 30', url: `http://127.0.0.1:${port}`, ready_timeout: 1}));
    const err = await runScreenshots(config, root, shellAppServer(root), pageWriter).catch(e => e);
    expect(err).toBeInstanceOf(UiInfrastructureError);
    expect(err.message).toContain('did not answer');
  });
});
