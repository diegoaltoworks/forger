import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {manifestDependencies} from './intent';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(manifest?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-intent-'));
  dirs.push(root);
  if (manifest !== undefined) writeFileSync(join(root, 'package.json'), manifest);
  return root;
}

describe('manifestDependencies', () => {
  test('lists runtime and dev dependencies', () => {
    const root = repo(JSON.stringify({dependencies: {phaser: '1'}, devDependencies: {typescript: '5'}}));
    expect(manifestDependencies(root)).toEqual(['phaser', 'typescript']);
  });
  test('is empty without a manifest or with a broken one', () => {
    expect(manifestDependencies(repo())).toEqual([]);
    expect(manifestDependencies(repo('{nope'))).toEqual([]);
  });
});

describe('the intent command', () => {
  test('prints JSON with the signals', async () => {
    const {intent} = await import('./intent');
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const root = repo(JSON.stringify({dependencies: {phaser: '1'}}));
    intent.run({values: {request: 'A playful demo', json: true}, projectRoot: root} as never);
    const out = JSON.parse(log.mock.calls[0]![0] as string);
    log.mockRestore();
    expect(out.intent).toBe('creative');
    expect(out.signals.map((s: {id: string}) => s.id)).toEqual(['demo', 'playful', 'dependency']);
  });
  test('refuses an empty request', async () => {
    const {intent} = await import('./intent');
    const err = spyOn(console, 'error').mockImplementation(() => {});
    intent.run({values: {}, projectRoot: repo()} as never);
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
