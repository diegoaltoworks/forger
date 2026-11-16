import {describe, expect, test} from 'bun:test';

import {otherEngine, otherEngineMessage, otherEngineReason, otherEngineRun} from './engine-changed';

const worker = (root?: string) => ({FORGER_ROLE: 'worker', ...(root ? {FORGER_PLUGIN_ROOT: root} : {})});
const same = (p: string) => p;

describe('otherEngine', () => {
  test('a worker started by another engine is on another engine', () => {
    expect(otherEngine(worker('/loop/plugin'), '/tree/plugin', same)).toEqual({startedBy: '/loop/plugin', engine: '/tree/plugin'});
  });

  test('a worker whose engine is reached through a symbolic link is not on another engine', () => {
    const resolve = (p: string) => (p === '/link/plugin' ? '/loop/plugin' : p);
    expect(otherEngine(worker('/loop/plugin'), '/link/plugin', resolve)).toBeNull();
  });

  test('a session with no worker role or no engine root is not on another engine', () => {
    expect(otherEngine({FORGER_PLUGIN_ROOT: '/loop/plugin'}, '/tree/plugin', same)).toBeNull();
    expect(otherEngine({FORGER_ROLE: 'supervisor', FORGER_PLUGIN_ROOT: '/loop/plugin'}, '/tree/plugin', same)).toBeNull();
    expect(otherEngine(worker(), '/tree/plugin', same)).toBeNull();
  });
});

describe('the refusal text', () => {
  test('names the command through the starting engine and the rule', () => {
    const run = otherEngineRun('merge', ['--pr 9'], "/a b/plugin");
    expect(run).toBe("bun '/a b/plugin/bin/work.ts' merge --pr 9");
    expect(otherEngineMessage('merge', {startedBy: '/a b/plugin', engine: '/t'}, run)).toContain(run);
    expect(otherEngineReason('merge', '/t')).toBe('other-engine: merge from /t');
  });
});
