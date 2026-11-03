import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {type BacklogData, backlogFrom} from './backlog';
import type {ClaudeResult, RunClaudeOptions} from './claude';
import {mergeConfig} from './config';
import {AutomationRunner} from './runner';
import {defaultState} from './state';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const backlog: BacklogData = {
  features: {
    the_ticket: {priority: 'P1', status: 'not_started', depends_on: []},
  },
};

interface GitScene {
  /** The remote base moves during the run. */
  merge?: boolean;
  /** The branch the worker checks out during the run. */
  branch?: string;
  pushed?: boolean;
}

/**
 * A git stub with a before and an after: the snapshot reads the first state,
 * and everything after the worker spawn reads the second.
 */
function sceneRunner(scene: GitScene, spawned: () => boolean) {
  return (cmd: string): string => {
    const after = spawned();
    if (cmd === 'git branch --show-current') return 'main';
    if (cmd === 'git rev-parse origin/main') return after && scene.merge ? 'bbb' : 'aaa';
    if (cmd === 'git merge-base --is-ancestor aaa bbb && echo yes') return 'yes';
    if (cmd === 'git reflog --format=%gs') {
      return after && scene.branch
        ? `checkout: moving from ${scene.branch} to main\ncheckout: moving from main to ${scene.branch}\nold`
        : 'old';
    }
    if (scene.branch && cmd === `git ls-remote --heads origin ${scene.branch}`) {
      return scene.pushed ? 'ccc' : '';
    }
    return '';
  };
}

function runnerWith(
  result: ClaudeResult,
  scene: GitScene = {},
  data: BacklogData = backlog
): {
  runner: AutomationRunner;
  root: string;
  calls: RunClaudeOptions[];
} {
  const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
  dirs.push(root);
  const calls: RunClaudeOptions[] = [];
  const config = mergeConfig({limits: {timeoutMinutes: 7, killGraceSeconds: 11, maxStallIterations: 2}});
  const runner = new AutomationRunner(root, config, backlogFrom(() => data, config), {
    runClaude: async opts => {
      calls.push(opts);
      return result;
    },
    gitRunner: sceneRunner(scene, () => calls.length > 0),
    uuid: () => '00000000-0000-0000-0000-000000000000',
  });
  return {runner, root, calls};
}

function readState(root: string) {
  return JSON.parse(readFileSync(join(root, '.claude', 'state.json'), 'utf-8'));
}

const done: BacklogData = {
  features: {
    the_ticket: {priority: 'P1', status: 'completed', depends_on: []},
    other: {priority: 'P1', status: 'completed', depends_on: []},
  },
};

function iterationLog(root: string, n: number): string {
  return readFileSync(join(root, '.claude', 'output', `iteration-${n}.log`), 'utf-8');
}

describe('AutomationRunner iteration log', () => {
  test('passes the timeout and kill grace from config to the worker spawn', async () => {
    const {runner, calls} = runnerWith({
      exitCode: 0,
      signal: null,
      output: '<process>complete</process>',
      timedOut: false,
    });
    await runner.runIteration(1);
    expect(calls[0].timeoutMinutes).toBe(7);
    expect(calls[0].killGraceSeconds).toBe(11);
  });

  test('is written on success', async () => {
    const {runner, root} = runnerWith({
      exitCode: 0,
      signal: null,
      output: 'done <process>complete</process>\n',
      timedOut: false,
    }, {merge: true});
    expect(await runner.runIteration(1)).toBe(true);
    const log = iterationLog(root, 1);
    expect(log).toContain('ticket: the_ticket');
    expect(log).toContain('outcome: exited with code 0');
    expect(log).toContain('done <process>complete</process>');
  });

  test('is written on failure', async () => {
    const {runner, root} = runnerWith({exitCode: 2, signal: null, output: '', timedOut: false});
    expect(await runner.runIteration(2)).toBe(false);
    const log = iterationLog(root, 2);
    expect(log).toContain('outcome: exited with code 2');
    expect(log).toContain('(no output captured)');
  });

  test('is written on timeout, naming the ticket, elapsed time and signal', async () => {
    const {runner, root} = runnerWith({
      exitCode: 1,
      signal: 'SIGKILL',
      output: 'partial work\n',
      timedOut: true,
    });
    expect(await runner.runIteration(3)).toBe(false);
    const log = iterationLog(root, 3);
    expect(log).toContain('ticket: the_ticket');
    expect(log).toMatch(/elapsed: \d+s/);
    expect(log).toContain('outcome: timed out after 7 minutes, ended by SIGKILL');
    expect(log).toContain('partial work');
    const state = readState(root);
    expect(state.status).toBe('timeout');
    expect(state.last_error).toBe('Timeout after 7 minutes, ended by SIGKILL');
  });
});

describe('AutomationRunner outcome from facts', () => {
  const timedOut: ClaudeResult = {exitCode: 1, signal: 'SIGKILL', output: '', timedOut: true};

  test('a timed-out run whose PR merged is a success and resets the failure counter', async () => {
    const {runner, root} = runnerWith(timedOut, {merge: true, branch: 'feat/the_ticket'}, done);
    writeFileSync(
      join(root, '.claude', 'state.json'),
      JSON.stringify({...defaultState(), consecutive_failures: 2, stall_count: 1})
    );

    expect(await runner.runIteration(2)).toBe(true);
    const state = readState(root);
    expect(state.status).toBe('completed');
    expect(state.stall_count).toBe(0);
    expect(state.consecutive_failures).toBe(0);
    expect(state.completed_tasks).toEqual(['the_ticket']);
  });

  test('a completion claim with nothing merged is a failure', async () => {
    const {runner, root} = runnerWith({
      exitCode: 0,
      signal: null,
      output: '<process>complete</process>',
      timedOut: false,
    });
    expect(await runner.runIteration(1)).toBe(false);
    expect(readState(root).last_error).toBe('Claimed complete but nothing merged into main');
  });

  test('a ticket marked completed but not merged is reported and halts, not progress', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {branch: 'feat/the_ticket', pushed: true},
      done
    );
    expect(await runner.runIteration(1)).toBe(false);
    const state = readState(root);
    expect(state.status).toBe('halted');
    expect(state.completed_tasks).toEqual([]);
    expect(state.stall_count).toBe(1);
    expect(state.last_error).toContain('"the_ticket" reads completed in the backlog but nothing merged');
    expect(existsSync(join(root, '.claude', 'HALT'))).toBe(true);
  });

  test('stalls by merges: runs without a merge halt the loop', async () => {
    const {runner, root} = runnerWith({exitCode: 1, signal: null, output: '', timedOut: false});
    await runner.runIteration(1);
    expect(existsSync(join(root, '.claude', 'HALT'))).toBe(false);
    await runner.runIteration(2);
    expect(readState(root).last_error).toBe('Stalled: nothing merged in 2 iterations');
    expect(existsSync(join(root, '.claude', 'HALT'))).toBe(true);
  });

  test('a branch naming no backlog ticket leaves the run held to the engine pick', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '', timedOut: false},
      {merge: true, branch: 'fix/typo'}
    );
    expect(await runner.runIteration(1)).toBe(true);
    expect(iterationLog(root, 1)).toContain('ticket: the_ticket\n');
    expect(iterationLog(root, 1)).not.toContain('engine pick');
  });

  test('logs the ticket the worker took when it differs from the engine pick', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {merge: true, branch: 'feat/other'},
      {features: {...backlog.features, other: {priority: 'P1', status: 'completed'}}}
    );
    expect(await runner.runIteration(1)).toBe(true);
    const log = iterationLog(root, 1);
    expect(log).toContain('ticket: other\nengine pick: the_ticket\n');
    expect(readFileSync(join(root, '.claude', 'work.log'), 'utf-8')).toContain(
      'Worker took other (engine picked the_ticket)'
    );
    expect(readState(root).completed_tasks).toEqual(['other']);
  });
});

describe('AutomationRunner infrastructure errors and resume', () => {
  test('an infrastructure error halts at once and leaves the failure counter alone', async () => {
    const {runner, root} = runnerWith({
      exitCode: 1,
      signal: null,
      output: 'Credit balance is too low',
      timedOut: false,
    });
    expect(await runner.runIteration(1)).toBe(false);
    const state = readState(root);
    expect(state.status).toBe('halted');
    expect(state.consecutive_failures).toBe(0);
    expect(state.failed_iterations).toBe(0);
    expect(state.last_error).toContain('billing');
    expect(existsSync(join(root, '.claude', 'HALT'))).toBe(true);
  });

  test('resume zeroes the failure and stall counters', async () => {
    const {runner, root} = runnerWith({exitCode: 1, signal: null, output: '', timedOut: false});
    await runner.runIteration(1);
    await runner.runIteration(2);
    expect(readState(root).consecutive_failures).toBe(2);
    runner.clearHalt();
    const state = readState(root);
    expect(state.consecutive_failures).toBe(0);
    expect(state.stall_count).toBe(0);
    expect(state.status).toBe('ready');
    expect(existsSync(join(root, '.claude', 'HALT'))).toBe(false);
  });

  test('resume clears counters even when no HALT file was left', () => {
    const {runner, root} = runnerWith({exitCode: 1, signal: null, output: '', timedOut: false});
    mkdirSync(join(root, '.claude'), {recursive: true});
    writeFileSync(
      join(root, '.claude', 'state.json'),
      JSON.stringify({...defaultState(), consecutive_failures: 3, stall_count: 4})
    );
    runner.clearHalt();
    expect(readState(root).consecutive_failures).toBe(0);
    expect(readState(root).stall_count).toBe(0);
  });

  test('the first iteration after a start is never counted as a stall', async () => {
    const {runner, root} = runnerWith({exitCode: 1, signal: null, output: '', timedOut: false});
    await runner.runIteration(1, false);
    expect(readState(root).stall_count).toBe(0);
    await runner.runIteration(2);
    expect(readState(root).stall_count).toBe(1);
  });

  test('a stale stall count does not survive a fresh start', async () => {
    const {root} = runnerWith({exitCode: 1, signal: null, output: '', timedOut: false});
    writeFileSync(
      join(root, '.claude', 'state.json'),
      JSON.stringify({...defaultState(), stall_count: 4})
    );
    const config = mergeConfig({
      limits: {pauseBetweenIterations: 0, pauseAfterFailure: 0, maxStallIterations: 2},
    });
    const runner = new AutomationRunner(root, config, backlogFrom(() => backlog, config), {
      runClaude: async () => ({exitCode: 1, signal: null, output: '', timedOut: false}),
      gitRunner: () => '',
    });
    await runner.run(1);
    expect(readState(root).stall_count).toBe(0);
    expect(existsSync(join(root, '.claude', 'HALT'))).toBe(false);
  });
});
