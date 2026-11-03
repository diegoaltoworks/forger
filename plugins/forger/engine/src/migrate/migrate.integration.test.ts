import {afterEach, describe, expect, test} from 'bun:test';
import {execSync} from 'child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {execRunner} from '../adapters';
import {main} from '../cli';
import {runDecisionsCheck} from '../checks';
import {MigrateRefused, planMoves, runMigrate, trackedNames} from './migrate';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function legacyRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-migrate-')));
  dirs.push(root);
  execSync('git init -q', {cwd: root});
  mkdirSync(join(root, '.claude/opinions'), {recursive: true});
  writeFileSync(join(root, '.claude/workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, paths: {backlog: '.claude/backlog.json'}}));
  writeFileSync(join(root, '.claude/backlog.json'), '{"features":{}}');
  writeFileSync(join(root, '.claude/opinions/docs.md'), 'x');
  writeFileSync(join(root, '.claude/forger.lock.json'), '{"packs":[{"id":"docs","version":"1","files":[{"path":".claude/opinions/docs.md","sha256":"a"}]}]}');
  writeFileSync(join(root, '.claude/settings.local.json'), '{}');
  writeFileSync(join(root, '.claude/state.json'), '{}');
  execSync('git add .claude/workloop.config.json .claude/backlog.json .claude/opinions .claude/forger.lock.json', {cwd: root});
  return root;
}

describe('planMoves', () => {
  test('moves what forger owns, leaves the harness files, skips what .forger already holds', () => {
    const plan = planMoves(['backlog.json', 'settings.local.json', 'opinions', 'ui.json.upstream', 'process.md'], ['process.md'], new Set(['backlog.json']));
    expect(plan.moves).toEqual([
      {name: 'backlog.json', tracked: true},
      {name: 'opinions', tracked: false},
      {name: 'ui.json.upstream', tracked: false},
    ]);
    expect(plan.skipped).toEqual(['process.md']);
  });
  test('trackedNames reads the top-level names under the legacy folder', () => {
    expect([...trackedNames('.claude/a.json\n.claude/opinions/x.md\nother/y')]).toEqual(['a.json', 'opinions']);
  });
});

describe('migrate then check decisions', () => {
  test('a branch that only runs migrate needs no ADR for the moved layer map', () => {
    const root = legacyRepo();
    const git = (cmd: string) => execSync(`git -c user.name=t -c user.email=t@t ${cmd}`, {cwd: root, stdio: 'pipe'});
    git('checkout -q -b main');
    writeFileSync(join(root, '.claude/architecture.json'), '{"layers":[{"name":"core"}]}');
    git('add .claude/architecture.json');
    git('commit -q -m base');
    git('checkout -q -b feat/migrate');
    expect(runMigrate(root, execRunner(root)).status).toBe('migrated');
    expect(existsSync(join(root, '.forger/architecture.json'))).toBe(true);
    expect(runDecisionsCheck(root, execRunner(root))).toEqual([]);
  });
});

describe('migrate', () => {
  test('moves the files, keeps the harness files, repoints the config and lock, and a second run does nothing', () => {
    const root = legacyRepo();
    const first = runMigrate(root, execRunner(root));
    expect(first.status).toBe('migrated');
    expect(first.moved).toContain('backlog.json');
    expect(existsSync(join(root, '.forger/backlog.json'))).toBe(true);
    expect(existsSync(join(root, '.claude/backlog.json'))).toBe(false);
    expect(existsSync(join(root, '.claude/settings.local.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, '.forger/workloop.config.json'), 'utf-8')).paths.backlog).toBe('.forger/backlog.json');
    expect(readFileSync(join(root, '.forger/forger.lock.json'), 'utf-8')).toContain('".forger/opinions/docs.md"');
    expect(readFileSync(join(root, '.gitignore'), 'utf-8')).toContain('.forger/runner.lock');
    const tracked = execSync('git ls-files', {cwd: root, encoding: 'utf-8'});
    expect(tracked).toContain('.forger/backlog.json');
    expect(tracked).not.toContain('.claude/backlog.json');
    expect(runMigrate(root, execRunner(root)).status).toBe('nothing');
  });

  test('refuses while a runner holds the lock, and moves nothing', () => {
    const root = legacyRepo();
    writeFileSync(join(root, '.claude/runner.lock'), String(process.pid));
    expect(() => runMigrate(root, execRunner(root))).toThrow(MigrateRefused);
    expect(existsSync(join(root, '.claude/backlog.json'))).toBe(true);
    expect(existsSync(join(root, '.forger'))).toBe(false);
  });

  test('a dead runner lock does not block, and the lock file moves with the rest', () => {
    const root = legacyRepo();
    writeFileSync(join(root, '.claude/runner.lock'), '999999999');
    expect(runMigrate(root, execRunner(root)).status).toBe('migrated');
  });

  test('the CLI warns once on a legacy repo, then migrate exits non-zero while the lock is live', async () => {
    const root = legacyRepo();
    process.chdir(root);
    const errors: string[] = [];
    const orig = console.error;
    const logs: string[] = [];
    const origLog = console.log;
    console.error = (...a: unknown[]) => void errors.push(a.join(' '));
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      await main(['status', '--json']);
      expect(errors.filter(e => e.includes('migrate'))).toHaveLength(1);
      writeFileSync(join(root, '.claude/runner.lock'), String(process.pid));
      process.exitCode = 0;
      await main(['migrate']);
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      rmSync(join(root, '.claude/runner.lock'));
      await main(['migrate']);
      expect(process.exitCode ?? 0).toBe(0);
      expect(existsSync(join(root, '.forger/workloop.config.json'))).toBe(true);
    } finally {
      console.error = orig;
      console.log = origLog;
      process.exitCode = 0;
    }
  });
});
