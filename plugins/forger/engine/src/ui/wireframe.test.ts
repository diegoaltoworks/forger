import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join, resolve} from 'path';

import {staticAppServer} from '../adapters';
import {runDocsCheck} from '../checks';
import type {Screenshotter} from '../ports';
import {runScreenshots} from './capture';
import {parseUiConfig} from './ui-config';
import {WireframeError, wireframePlan} from './wireframe';

const PACK = resolve(import.meta.dir, '../../../packs/ui/files');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const base = parseUiConfig(JSON.stringify({paths: ['src/**'], start: 'bun run dev', url: 'http://localhost:3000'}));

describe('wireframePlan', () => {
  test('serves docs/design and captures the ticket page light only, beside it', () => {
    const plan = wireframePlan(base, 'issue-44', 4100);
    expect(plan).toMatchObject({dir: 'docs/design/issue-44/', root: 'docs/design/', page: 'issue-44/index.html'});
    expect(plan.config).toMatchObject({url: 'http://127.0.0.1:4100', routes: ['/issue-44/'], themes: ['light']});
    expect(plan.config.viewports).toEqual(base.viewports);
  });
  for (const bad of ['', '../x', 'a/b', '-x', 'A', 'a..b/', '.hidden']) {
    test(`rejects "${bad}"`, () => expect(() => wireframePlan(base, bad, 1)).toThrow(WireframeError));
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-wire-'));
  dirs.push(root);
  mkdirSync(join(root, 'docs/design/example'), {recursive: true});
  writeFileSync(join(root, 'docs/design/wireframe.css'), readFileSync(join(PACK, 'wireframe.css')));
  writeFileSync(join(root, 'docs/design/example/index.html'), readFileSync(join(PACK, 'example.html')));
  return root;
}

const pageWriter: Screenshotter = {
  async capture(shots) {
    for (const s of shots) {
      const page = await (await fetch(s.url)).text();
      const css = await (await fetch(new URL('../wireframe.css', s.url))).text();
      mkdirSync(dirname(s.file), {recursive: true});
      writeFileSync(s.file, `${page.includes('<main class="wf-screen">')}|${css.includes('.wf-box')}|${s.width}x${s.height}`);
    }
  },
};

describe('the shipped example wireframe', () => {
  test('is served with its stylesheet and captured beside the page', async () => {
    const root = project();
    const port = Bun.serve({port: 0, fetch: () => new Response('')});
    const free = port.port as number;
    port.stop(true);
    const plan = wireframePlan(base, 'example', free);
    const report = await runScreenshots(plan.config, root, staticAppServer(join(root, plan.root), free), pageWriter, plan.dir);
    expect(report.files).toEqual(['docs/design/example/example-phone-light.png', 'docs/design/example/example-desktop-light.png']);
    expect(readFileSync(join(root, report.files[0]), 'utf-8')).toBe('true|true|390x844');
    await expect(fetch(`http://127.0.0.1:${free}/`, {signal: AbortSignal.timeout(1000)})).rejects.toThrow();
  });

  test('passes check docs', () => {
    const root = project();
    const files = 'docs/design/wireframe.css\ndocs/design/example/index.html';
    expect(runDocsCheck(root, () => files, ['base', 'docs'])).toEqual([]);
  });
});

describe('staticAppServer', () => {
  test('never serves outside its folder', async () => {
    const root = project();
    writeFileSync(join(root, 'secret.txt'), 'secret');
    const probe = Bun.serve({port: 0, fetch: () => new Response('')});
    const port = probe.port as number;
    probe.stop(true);
    const server = staticAppServer(join(root, 'docs/design'), port);
    await server.start('');
    try {
      expect((await fetch(`http://127.0.0.1:${port}/wireframe.css`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/example/`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/secret.txt`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
    } finally {
      await server.stop();
    }
    expect(existsSync(join(root, 'secret.txt'))).toBe(true);
  });
});
