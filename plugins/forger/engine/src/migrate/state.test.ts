import {afterAll, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {execCapture, gitStateStore} from '../adapters';
import {MigrateRefused} from './migrate';
import {runMigrateState, splitEventsByDay} from './state';

const root = mkdtempSync(join(tmpdir(), 'forger-migrate-state-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));

const sh = (cwd: string, cmd: string) => {
  const r = execCapture(cwd)(cmd);
  if (r.exitCode !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout;
};

const ev = (at: string, n: number) => JSON.stringify({event: 'completed', at, iteration: n, ticket: null, reason: null});
const LINES = [
  ev('2026-01-01T10:00:00Z', 1),
  'not json at all',
  ev('2026-01-01T23:59:59Z', 2),
  ev('2026-01-02T00:00:01Z', 3),
  ev('2026-01-01T12:00:00Z', 4),
  ev('2026-01-03T00:00:00Z', 5),
];

let n = 0;
function fixture() {
  const dir = join(root, String(n++));
  sh(root, `git init --bare -q ${dir}/remote.git`);
  const repo = join(dir, 'repo');
  sh(root, `git clone -q ${dir}/remote.git ${repo} 2>/dev/null`);
  mkdirSync(join(repo, '.forger'), {recursive: true});
  writeFileSync(join(repo, '.forger/workloop.config.json'), '{"tracker":{"kind":"local"}}');
  writeFileSync(join(repo, '.forger/state.json'), '{"iteration":5}');
  writeFileSync(join(repo, '.forger/events.jsonl'), `${LINES.join('\n')}\n`);
  return {repo, remote: `${dir}/remote.git`, branch: () => gitStateStore({repo})};
}

describe('splitEventsByDay', () => {
  test('keeps every line in order, a line without a day stays with the one before', () => {
    const files = splitEventsByDay(`${LINES.join('\n')}\n`, '2026-02-01');
    expect(Object.keys(files)).toEqual(['events/2026-01-01.jsonl', 'events/2026-01-02.jsonl', 'events/2026-01-03.jsonl']);
    const rejoined = Object.keys(files).sort().map(k => files[k]).join('');
    expect(rejoined).toBe(`${LINES.join('\n')}\n`);
  });
  test('an undated start takes the fallback day', () => {
    expect(Object.keys(splitEventsByDay('x\n', '2026-02-01'))).toEqual(['events/2026-02-01.jsonl']);
  });
});

describe('runMigrateState', () => {
  test('commits state and events with every event preserved, sets state.home, leaves local files', () => {
    const f = fixture();
    const r = runMigrateState({projectRoot: f.repo, branch: f.branch()});
    expect(r.status).toBe('migrated');
    const store = gitStateStore({repo: f.repo});
    expect(store.readState()).toBe('{"iteration":5}');
    expect(store.readEvents()).toBe(`${LINES.join('\n')}\n`);
    expect(sh(f.remote, 'git rev-list --max-parents=0 forger-state | wc -l').trim()).toBe('1');
    expect(sh(f.remote, 'git rev-list --count forger-state').trim()).toBe('1');
    const config = JSON.parse(readFileSync(join(f.repo, '.forger/workloop.config.json'), 'utf-8'));
    expect(config.state).toEqual({home: 'branch', branch: 'forger-state'});
    expect(config.tracker.kind).toBe('local');
    expect(readFileSync(join(f.repo, '.forger/events.jsonl'), 'utf-8')).toBe(`${LINES.join('\n')}\n`);
  });

  test('a second run changes nothing', () => {
    const f = fixture();
    runMigrateState({projectRoot: f.repo, branch: f.branch()});
    const tip = sh(f.remote, 'git rev-parse forger-state');
    const config = readFileSync(join(f.repo, '.forger/workloop.config.json'), 'utf-8');
    expect(runMigrateState({projectRoot: f.repo, branch: f.branch()})).toMatchObject({status: 'nothing', seeded: []});
    expect(sh(f.remote, 'git rev-parse forger-state')).toBe(tip);
    expect(readFileSync(join(f.repo, '.forger/workloop.config.json'), 'utf-8')).toBe(config);
  });

  test('refuses with a live runner lock, and writes nothing', () => {
    const f = fixture();
    writeFileSync(join(f.repo, '.forger/runner.lock'), String(process.pid));
    expect(() => runMigrateState({projectRoot: f.repo, branch: f.branch()})).toThrow(MigrateRefused);
    expect(sh(f.remote, 'git branch --list forger-state')).toBe('');
    expect(readFileSync(join(f.repo, '.forger/workloop.config.json'), 'utf-8')).not.toContain('branch');
  });

  test('refuses with a live local lease, and with a live lease on the branch', () => {
    const f = fixture();
    const now = new Date('2026-01-01T00:05:00Z');
    const lease = {holder: 'other', host: 'h', acquired_at: '2026-01-01T00:00:00Z', renewed_at: '2026-01-01T00:00:00Z', ttl_seconds: 900};
    writeFileSync(join(f.repo, '.forger/lease.json'), JSON.stringify(lease));
    expect(() => runMigrateState({projectRoot: f.repo, branch: f.branch(), now})).toThrow(/live lease/);
    expect(runMigrateState({projectRoot: f.repo, branch: f.branch(), now: new Date('2026-01-01T02:00:00Z')}).status).toBe('migrated');

    const g = fixture();
    gitStateStore({repo: g.repo}).claimLease({self: 'other', host: 'h', ttlSeconds: 900, now: new Date()});
    expect(() => runMigrateState({projectRoot: g.repo, branch: g.branch()})).toThrow(/live lease/);
  });

  test('a remote that refuses the push is reported, not swallowed', () => {
    const f = fixture();
    writeFileSync(join(f.remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', {mode: 0o755});
    expect(() => runMigrateState({projectRoot: f.repo, branch: f.branch()})).toThrow(MigrateRefused);
  });
});
