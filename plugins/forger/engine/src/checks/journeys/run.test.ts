import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../../ports';
import {journeysOf, runJourneysCheck} from './run';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(config: object | null): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-journeys-'));
  dirs.push(root);
  if (config !== null) {
    mkdirSync(join(root, '.forger'));
    writeFileSync(join(root, '.forger', 'journeys.json'), JSON.stringify(config));
  }
  return root;
}

const j = (name: string, command: string) => ({name, command, paths: ['src/**']});

/** Canned shell: a command's exit status by the journey command it wraps; records every call. */
function shell(exits: Record<string, number>, calls: string[] = []): CommandRunner {
  return cmd => {
    calls.push(cmd);
    if (cmd.startsWith('setsid')) return 'forger-journey-pid:4242\n';
    if (cmd.startsWith('kill')) return '';
    const hit = Object.keys(exits).find(c => cmd.includes(c));
    return `some output\nforger-journey-exit:${hit === undefined ? 0 : exits[hit]}\n`;
  };
}

describe('runJourneysCheck', () => {
  test('a journey whose command exits non-zero is a finding that names it', () => {
    const root = repo({journeys: [j('sign up', 'run-signup'), j('checkout', 'run-checkout')]});
    const {findings} = runJourneysCheck(root, shell({'run-signup': 3}));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({opinion: 'journeys.pass', rule: 'journey-failed'});
    expect(findings[0].detail).toContain('"sign up" exited 3');
    expect(findings[0].detail).toContain('some output');
  });

  test('every journey passing is no finding', () => {
    const root = repo({journeys: [j('a', 'run-a'), j('b', 'run-b')]});
    expect(runJourneysCheck(root, shell({}))).toEqual({findings: [], gaps: []});
  });

  test('an entry with no command is a config error that names the entry', () => {
    const root = repo({journeys: [{name: 'sign up', paths: ['src/**']}]});
    expect(() => runJourneysCheck(root, shell({}))).toThrow('journeys[0] ("sign up") needs a "command"');
  });

  test('an empty journeys list is a gap, not a pass', () => {
    const calls: string[] = [];
    const out = runJourneysCheck(repo({journeys: [], start: 'serve'}), shell({}, calls));
    expect(out.findings).toEqual([]);
    expect(out.gaps).toEqual([{file: '.forger/journeys.json', opinion: 'journeys.named', modality: 'SHOULD', detail: 'no journey is named'}]);
    expect(calls).toEqual([]);
  });

  test('the app is stopped after the run even when a journey fails', () => {
    const calls: string[] = [];
    const root = repo({journeys: [j('a', 'run-a')], start: 'serve', ready: 'curl -f localhost'});
    const {findings} = runJourneysCheck(root, shell({'run-a': 1}, calls));
    expect(findings).toHaveLength(1);
    expect(calls[0]).toStartWith('setsid');
    expect(calls.at(-1)).toContain('kill -TERM -- -4242');
  });

  test('the app is stopped when the runner throws', () => {
    const calls: string[] = [];
    const root = repo({journeys: [j('a', 'run-a')], start: 'serve'});
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      if (cmd.startsWith('setsid')) return 'forger-journey-pid:7\n';
      if (cmd.includes('run-a')) throw new Error('boom');
      return '';
    };
    expect(() => runJourneysCheck(root, run)).toThrow('boom');
    expect(calls.at(-1)).toContain('kill -TERM -- -7');
  });

  test('an app that is never ready is one finding, no journey runs, and it is stopped', () => {
    const calls: string[] = [];
    const root = repo({journeys: [j('a', 'run-a')], start: 'serve', ready: 'check-up', ready_seconds: 5});
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      if (cmd.startsWith('setsid')) return 'forger-journey-pid:9\n';
      return cmd.includes('check-up') ? 'forger-journey-exit:1\n' : '';
    };
    const {findings} = runJourneysCheck(root, run);
    expect(findings.map(f => f.rule)).toEqual(['app-not-ready']);
    expect(calls.some(c => c.includes('run-a'))).toBe(false);
    expect(calls.at(-1)).toContain('kill');
  });

  test('an app whose start reports no pid is a finding', () => {
    const root = repo({journeys: [j('a', 'run-a')], start: 'serve'});
    expect(runJourneysCheck(root, () => '').findings.map(f => f.rule)).toEqual(['app-cannot-start']);
  });

  test('a journey the shell could not start is reported as such', () => {
    const root = repo({journeys: [j('a', 'run-a')]});
    expect(runJourneysCheck(root, shell({'run-a': 127})).findings.map(f => f.rule)).toEqual(['journey-cannot-start']);
  });

  test('a missing config is an error, never a pass', () => {
    expect(() => runJourneysCheck(repo(null), shell({}))).toThrow('not found');
  });
});

describe('journeysOf', () => {
  test('is empty without the pack and lists the named journeys with it', () => {
    expect(journeysOf(repo(null))).toEqual([]);
    expect(journeysOf(repo({journeys: [j('a', 'x')]})).map(x => x.name)).toEqual(['a']);
  });
});
