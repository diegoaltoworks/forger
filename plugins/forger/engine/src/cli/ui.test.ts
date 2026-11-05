import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import type {CommandContext} from './command';
import {ui} from './ui';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
  process.exitCode = 0;
});

function project(captured: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-ui-approve-'));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  mkdirSync(join(root, 'docs/screenshots'), {recursive: true});
  writeFileSync(join(root, '.forger/ui.json'), JSON.stringify({paths: ['a'], start: 's', routes: ['/'], viewports: [{name: 'phone', width: 10, height: 10}], themes: ['light'], states: [{name: 'empty-cart', route: '/cart'}]}));
  if (captured) writeFileSync(join(root, 'docs/screenshots/empty-cart-phone-light.png'), 'image');
  return root;
}

function ctx(root: string, args: string[], owner?: string): CommandContext {
  return {values: {owner}, positionals: ['ui', ...args], projectRoot: root, run: () => () => 'Git User\n'} as unknown as CommandContext;
}

describe('ui approve', () => {
  test('copies the captures to the baseline directory and records who approved', async () => {
    const root = project(true);
    const log = spyOn(console, 'log').mockImplementation(() => {});
    await ui.run(ctx(root, ['approve', 'empty-cart'], 'The Owner'));
    log.mockRestore();
    expect(readFileSync(join(root, '.forger/ui-baselines/empty-cart-phone-light.png'), 'utf-8')).toBe('image');
    expect(JSON.parse(readFileSync(join(root, '.forger/ui-baselines/approved.json'), 'utf-8'))).toEqual({
      approved: [{name: 'empty-cart', approved_by: 'The Owner', files: ['docs/screenshots/empty-cart-phone-light.png']}],
    });
  });

  test('without --owner the git user is recorded', async () => {
    const root = project(true);
    const log = spyOn(console, 'log').mockImplementation(() => {});
    await ui.run(ctx(root, ['approve', 'empty-cart']));
    log.mockRestore();
    expect(readFileSync(join(root, '.forger/ui-baselines/approved.json'), 'utf-8')).toContain('"approved_by": "Git User"');
  });

  test('a state that was never captured, or is not declared, approves nothing', async () => {
    const err = spyOn(console, 'error').mockImplementation(() => {});
    const root = project(false);
    await ui.run(ctx(root, ['approve', 'empty-cart'], 'o'));
    expect(process.exitCode).toBe(1);
    await ui.run(ctx(root, ['approve', 'nope'], 'o'));
    expect(err.mock.calls.map(c => String(c[0])).join('\n')).toContain('no state or route named "nope"');
    err.mockRestore();
    expect(existsSync(join(root, '.forger/ui-baselines'))).toBe(false);
  });
});
