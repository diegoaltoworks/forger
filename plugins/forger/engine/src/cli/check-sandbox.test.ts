import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {mergeConfig} from '../config';
import type {CommandRunner} from '../ports';
import {main} from './main';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  process.exitCode = 0;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(config: Record<string, unknown>): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-sbx-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features: {}}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, allow_unguarded: true, ...config}));
  process.chdir(root);
}

async function run(argv: string[], runner: CommandRunner): Promise<string> {
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  try {
    await main(argv, {run: runner});
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.join('\n');
}

/** A docker whose image lacks the named tools. */
const without = (missing: string[]): CommandRunner => cmd => {
  if (cmd.startsWith('git remote')) return 'https://github.com/acme/widgets.git';
  if (cmd.startsWith('docker run') && missing.some(m => cmd.includes(m))) throw new Error('exit 1');
  return '';
};

describe('check sandbox', () => {
  test('a config with no sandbox field runs workers on the host', () => {
    expect(mergeConfig({}).sandbox).toBe('host');
    expect(mergeConfig({}).sandbox_image).toBeNull();
    expect(mergeConfig({}).sandbox_engine_image).toBeNull();
  });

  test('check sandbox on the host sandbox exits 0', async () => {
    project({});
    const out = await run(['check', 'sandbox'], without([]));
    expect(out).toContain('nothing to check');
    expect(process.exitCode ?? 0).toBe(0);
  });

  test('check sandbox names each missing contract item', async () => {
    project({sandbox: 'docker', sandbox_image: 'mine:1', harness: 'claude'});
    const out = await run(['check', 'sandbox'], without(['command -v bun', 'command -v claude']));
    expect(out).toContain('pass git');
    expect(out).toContain('missing bun: install bun in the image');
    expect(out).toContain('missing harness CLI (claude)');
    expect(out).toContain('pass non-root user');
    expect(process.exitCode).toBe(1);
  });

  test('check sandbox exits 0 when every item passes, and refuses with no image', async () => {
    project({sandbox: 'docker', sandbox_image: 'mine:1'});
    const out = await run(['check', 'sandbox'], without([]));
    expect(out).not.toContain('missing');
    expect(process.exitCode ?? 0).toBe(0);
    project({sandbox: 'docker'});
    const refused = await run(['check', 'sandbox'], without([]));
    expect(refused).toContain('sandbox_image');
    expect(process.exitCode).toBe(1);
  });
});
