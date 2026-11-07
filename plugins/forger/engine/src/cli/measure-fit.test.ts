import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import type {CommandContext} from './command';
import {measure} from './measure';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
  process.exitCode = 0;
});

function project(ui?: object): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-measure-fit-'));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  if (ui !== undefined) writeFileSync(join(root, '.forger/ui.json'), JSON.stringify(ui));
  return root;
}

async function run(root: string, positionals: string[], values: Record<string, unknown> = {}): Promise<{err: string; code: number}> {
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await measure.run({values, positionals: ['measure', ...positionals], projectRoot: root} as unknown as CommandContext);
    return {err: error.mock.calls.map(a => String(a[0])).join('\n'), code: Number(process.exitCode ?? 0)};
  } finally {
    error.mockRestore();
  }
}

const ui = {paths: ['a'], start: 's', url: 'http://localhost:9', routes: ['/'], themes: ['light']};

describe('measure <target> <selector>', () => {
  test('needs a selector', async () => {
    const r = await run(project(ui), ['/']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('give a route or state and a selector');
  });

  test('needs the ui pack config', async () => {
    const r = await run(project(), ['/', 'h1']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('.forger/ui.json not found');
  });

  test('names a text file that is missing', async () => {
    const r = await run(project(ui), ['/', 'h1'], {text: '/nowhere/strings.json'});
    expect(r.code).toBe(1);
    expect(r.err).toContain('not found');
  });

  test('refuses a target that is neither a route nor a state, as JSON on request', async () => {
    const r = await run(project(ui), ['/missing', 'h1'], {json: true});
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toMatchObject({ok: false});
  });
});
