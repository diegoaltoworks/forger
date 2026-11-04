import {afterAll, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {type BacklogData, backlogFrom} from '../backlog';
import {execCapture, gitStateStore, memoryStateStore} from '../adapters';
import {mergeConfig} from '../config';
import {AutomationRunner} from './runner';

const root = mkdtempSync(join(tmpdir(), 'forger-lease-'));
afterAll(() => rmSync(root, {recursive: true, force: true}));

const sh = (cwd: string, cmd: string) => {
  const r = execCapture(cwd)(cmd);
  if (r.exitCode !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout;
};

const done: BacklogData = {features: {a: {priority: 'P1', status: 'completed', depends_on: []}}};
const config = mergeConfig({state: {home: 'branch'}, limits: {pauseBetweenIterations: 0, pauseAfterFailure: 0}});
const T0 = Date.parse('2026-01-01T00:00:00Z');

let n = 0;
/** Two engines, each in its own clone of one remote. */
function twoEngines() {
  const dir = join(root, String(n++));
  mkdirSync(dir);
  sh(root, `git init --bare -q ${dir}/remote.git`);
  const clones = ['a', 'b'].map(name => {
    const c = join(dir, name);
    sh(root, `git clone -q ${dir}/remote.git ${c} 2>/dev/null`);
    writeFileSync(join(c, 'code.txt'), 'work');
    sh(c, 'git add . && git -c user.name=t -c user.email=t@t commit -qm code');
    mkdirSync(join(c, '.forger'));
    return c;
  });
  const engine = (clone: string, self: string, now: () => number) =>
    new AutomationRunner(clone, config, backlogFrom(() => done, config), {
      stateStore: gitStateStore({repo: clone}),
      lease: {self, host: 'h', ttlSeconds: 900},
      gitRunner: () => '',
      now,
      pid: process.pid,
      sleep: async () => {},
    });
  return {clones, engine};
}

describe('AutomationRunner with the state on a branch', () => {
  test('one engine runs, the other refuses while the lease is live, and takes over after the TTL', async () => {
    const {clones, engine} = twoEngines();
    gitStateStore({repo: clones[0]}).claimLease({self: 'crashed', host: 'h0', ttlSeconds: 900, now: new Date(T0)});

    expect(await engine(clones[1], 'b', () => T0 + 60_000).run(1)).toBe(false);
    expect(await engine(clones[1], 'b', () => T0 + 901_000).run(1)).toBe(true);

    const events = gitStateStore({repo: clones[0]}).readEvents();
    expect(events).toContain('"event":"lease_takeover"');
    expect(events).toContain('crashed');
  });

  test('releases the lease when the loop ends, so the next engine acquires at once', async () => {
    const {clones, engine} = twoEngines();
    expect(await engine(clones[0], 'a', () => T0).run(1)).toBe(true);
    expect(gitStateStore({repo: clones[1]}).readLease()).toBe(null);
    expect(await engine(clones[1], 'b', () => T0 + 1000).run(1)).toBe(true);
  });
});

describe('AutomationRunner with the state local', () => {
  test('takes no lease', async () => {
    const dir = mkdtempSync(join(root, 'local-'));
    mkdirSync(join(dir, '.forger'));
    const store = memoryStateStore();
    const local = mergeConfig({limits: {pauseBetweenIterations: 0}});
    const runner = new AutomationRunner(dir, local, backlogFrom(() => done, local), {stateStore: store, gitRunner: () => ''});
    expect(await runner.run(1)).toBe(true);
    expect(store.lease).toBe(null);
  });

  test('a lost lease stops the loop without writing a HALT', async () => {
    const dir = mkdtempSync(join(root, 'lost-'));
    mkdirSync(join(dir, '.forger'));
    const store = memoryStateStore();
    store.claimLease = () => ({ok: false, reason: 'lost'});
    const runner = new AutomationRunner(dir, config, backlogFrom(() => done, config), {
      stateStore: store,
      lease: {self: 'a', host: 'h', ttlSeconds: 900},
      gitRunner: () => '',
    });
    expect(await runner.run(1)).toBe(false);
  });

  test('a stop signal releases the lease and exits, before the run ends', async () => {
    const dir = join(root, String(n++));
    mkdirSync(dir);
    const stateStore = memoryStateStore();
    const handlers: Array<() => void> = [];
    const exits: number[] = [];
    let during: unknown = 'unread';
    const backlog = backlogFrom(() => {
      handlers[0]?.();
      during = stateStore.lease;
      return done;
    }, config);
    const runner = new AutomationRunner(dir, config, backlog, {
      stateStore,
      lease: {self: 'h:1:aa', host: 'h', ttlSeconds: 900},
      gitRunner: () => '',
      now: () => T0,
      pid: process.pid,
      sleep: async () => {},
      onSignal: (_signal, handler) => handlers.push(handler),
      exit: code => void exits.push(code),
    });
    await runner.run(1);
    expect(handlers.length).toBe(2);
    expect(during).toBe(null);
    expect(exits).toEqual([143]);
  });

  test('takes over this host\'s lease for a dead pid, and says so', async () => {
    const dir = join(root, String(n++));
    mkdirSync(dir);
    const stateStore = memoryStateStore();
    stateStore.claimLease({self: 'h:111:aa', host: 'h', ttlSeconds: 900, now: new Date(T0)});
    const runner = new AutomationRunner(dir, config, backlogFrom(() => done, config), {
      stateStore,
      lease: {self: 'h:222:bb', host: 'h', ttlSeconds: 900},
      isAlive: () => false,
      gitRunner: () => '',
      now: () => T0 + 5000,
      pid: process.pid,
      sleep: async () => {},
    });
    expect(await runner.run(1)).toBe(true);
    expect(stateStore.readEvents()).toContain('lease_takeover');
  });

  test('refuses a live lease from another host even when its pid looks dead here', async () => {
    const dir = join(root, String(n++));
    mkdirSync(dir);
    const stateStore = memoryStateStore();
    stateStore.claimLease({self: 'other:111:aa', host: 'other', ttlSeconds: 900, now: new Date(T0)});
    const runner = new AutomationRunner(dir, config, backlogFrom(() => done, config), {
      stateStore,
      lease: {self: 'h:222:bb', host: 'h', ttlSeconds: 900},
      isAlive: () => false,
      gitRunner: () => '',
      now: () => T0 + 5000,
      pid: process.pid,
      sleep: async () => {},
    });
    expect(await runner.run(1)).toBe(false);
  });
});
