import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {shellAppServer} from '../../adapters';
import type {AccessibilityAuditor, AxeViolation} from '../../ports';
import {parseUiConfig} from '../../ui';
import {runA11y} from './a11y-check';

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

function port(): number {
  const s = Bun.serve({port: 0, fetch: () => new Response('')});
  const p = s.port as number;
  s.stop(true);
  return p;
}

/** Stands in for axe: reads the served page and reports what a rule would find in it. */
const auditor: AccessibilityAuditor = {
  async audit(pages) {
    return Promise.all(
      pages.map(async request => {
        const body = await (await fetch(request.url)).text();
        const violations: AxeViolation[] = body.includes('<img>')
          ? [{id: 'image-alt', impact: 'critical', help: 'Images must have alternate text', nodes: [{target: ['img']}]}]
          : [];
        return {request, results: {violations}};
      })
    );
  },
};

describe('check a11y against a fixture site', () => {
  test('the passing route is clean, the failing one is named, and the app is stopped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-a11y-'));
    dirs.push(root);
    mkdirSync(join(root, 'site'));
    writeFileSync(join(root, 'site', 'index.html'), '<h1>home</h1><img alt="logo">');
    writeFileSync(join(root, 'site', 'broken.html'), '<h1>broken</h1><img>');
    writeFileSync(join(root, 'serve.ts'), SERVER);
    const p = port();
    const config = parseUiConfig(
      JSON.stringify({paths: ['site/**'], start: `bun serve.ts site ${p}`, url: `http://127.0.0.1:${p}`, routes: ['/', '/broken'], ready_timeout: 20})
    );

    const findings = await runA11y(config, shellAppServer(root), auditor);

    expect(new Set(findings.map(f => f.file))).toEqual(new Set(['/broken']));
    expect(findings).toHaveLength(4);
    expect(findings.every(f => f.opinion === 'ui.a11y' && f.rule === 'image-alt')).toBe(true);
    await expect(fetch(`http://127.0.0.1:${p}/`, {signal: AbortSignal.timeout(1000)})).rejects.toThrow();
  });
});
