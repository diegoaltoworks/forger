import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {playwrightRecorder, shellAppServer} from '../adapters';
import type {GifEncoder} from '../ports';
import {runRecording} from './record';
import {parseUiConfig} from './ui-config';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

/** A project directory that has Playwright and a browser installed; CI sets it, a machine without one skips. */
const playwrightRoot = process.env.FORGER_PLAYWRIGHT_ROOT;

const SERVER = `
Bun.serve({
  port: Number(process.argv[2]),
  fetch: () => new Response(Bun.file('index.html'), {headers: {'content-type': 'text/html'}}),
});
`;

const PAGE = `<!doctype html><button id="go" onclick="document.title='played';this.textContent='played'">go</button>
<script>addEventListener('keydown', e => { if (e.key === 'ArrowRight') document.body.dataset.key = 'right'; });</script>`;

function freePort(): number {
  const s = Bun.serve({port: 0, fetch: () => new Response('')});
  const port = s.port as number;
  s.stop(true);
  return port;
}

describe.skipIf(playwrightRoot === undefined)('capture against a fixture app, with a real browser', () => {
  test('records the declared steps as a .webm', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-rec-'));
    dirs.push(root);
    mkdirSync(join(root, '.forger'));
    writeFileSync(join(root, 'index.html'), PAGE);
    writeFileSync(join(root, 'serve.ts'), SERVER);
    const port = freePort();
    const config = parseUiConfig(
      JSON.stringify({
        paths: ['index.html'],
        start: `bun serve.ts ${port}`,
        url: `http://127.0.0.1:${port}`,
        ready_timeout: 20,
        captures: [{name: 'play', viewport: 'phone', max_seconds: 30, steps: [{wait: '#go'}, {click: '#go'}, {key: 'ArrowRight'}, {pause: 300}]}],
      })
    );
    const noGif: GifEncoder = {encode: async () => true};
    const report = await runRecording(config, 'play', root, shellAppServer(root), playwrightRecorder(playwrightRoot as string), noGif);

    expect(report.files[0]).toBe('docs/screenshots/play.webm');
    const bytes = readFileSync(join(root, 'docs/screenshots/play.webm'));
    expect(bytes.length).toBeGreaterThan(1000);
    // EBML magic: a Matroska/WebM container.
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  }, 60_000);
});
