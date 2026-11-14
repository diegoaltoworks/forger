import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {type BacklogData, backlogFrom} from '../backlog';
import type {AgentResult, AgentRunOptions, ProbeRunner} from '../ports';
import {localStateFor, memoryStateStore} from '../adapters';
import {mergeConfig} from '../config';
import type {StoredPlan} from '../pipeline';
import {parseIterationLog} from '../supervisor';
import {RATE_LIMIT_MARGIN_MS, RateLimitError} from './infra';
import {AutomationRunner, WATCH_BACKLOG_EVERY} from './runner';
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
  /** The conclusion of the branch PR's one check; the PR reads merged when `merge` is set. */
  prCheck?: string;
  /** The decision recorded for the PR head; absent means a passing one, 'none' means no record. */
  verdict?: 'pass' | 'block' | 'none';
  /** The state of the `forger/verify` commit status on the PR head; absent means none is set. */
  verifyStatus?: 'SUCCESS' | 'FAILURE';
}

/**
 * A git stub with a before and an after: the snapshot reads the first state,
 * and everything after the worker spawn reads the second.
 */
function sceneRunner(scene: GitScene, spawned: () => boolean) {
  return (cmd: string): string => {
    const after = spawned();
    if (cmd === 'git branch --show-current') return 'main';
    if (scene.branch && cmd === `git log -3 --format="%h %s" ${scene.branch}`) return 'abc1234 third\ndef5678 second\n9990000 first';
    if (cmd === 'git rev-parse origin/main') return after && scene.merge ? 'bbb' : 'aaa';
    if (cmd === 'git merge-base --is-ancestor aaa bbb && echo yes') return 'yes';
    if (cmd === 'git reflog --format=%gs') {
      return after && scene.branch
        ? `checkout: moving from ${scene.branch} to main\ncheckout: moving from main to ${scene.branch}\nold`
        : 'old';
    }
    if (scene.branch && scene.prCheck && cmd === `gh pr view ${scene.branch} --json number,state,mergedAt,statusCheckRollup,headRefOid`) {
      return JSON.stringify({
        number: 75,
        headRefOid: 'head75',
        state: after && scene.merge ? 'MERGED' : 'OPEN',
        statusCheckRollup: [
          {__typename: 'CheckRun', name: 'gates', status: 'COMPLETED', conclusion: scene.prCheck},
          ...(scene.verifyStatus ? [{__typename: 'StatusContext', context: 'forger/verify', state: scene.verifyStatus}] : []),
        ],
      });
    }
    if (scene.branch && cmd === `git ls-remote --heads origin ${scene.branch}`) {
      return scene.pushed ? 'ccc' : '';
    }
    return '';
  };
}

function runnerWith(
  result: AgentResult,
  scene: GitScene = {},
  data: BacklogData = backlog,
  resolvePlan?: (ticket: string | null) => StoredPlan | null
): {
  runner: AutomationRunner;
  root: string;
  calls: AgentRunOptions[];
} {
  const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
  dirs.push(root);
  if (scene.prCheck && scene.verdict !== 'none') {
    const dir = join(root, '.forger', 'verdicts');
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, 'pr-75-head75.json'), JSON.stringify({pr: 75, head: 'head75', decision: scene.verdict ?? 'pass', entries: []}));
  }
  const calls: AgentRunOptions[] = [];
  const config = mergeConfig({limits: {timeoutMinutes: 7, killGraceSeconds: 11, maxStallIterations: 2}});
  const runner = new AutomationRunner(root, config, backlogFrom(() => data, config), {stateStore: localStateFor(root, config), 
    agent: {run: async opts => {
      calls.push(opts);
      return result;
    }},
    gitRunner: sceneRunner(scene, () => calls.length > 0),
    uuid: () => '00000000-0000-0000-0000-000000000000',
    resolvePlan,
  });
  return {runner, root, calls};
}

function readState(root: string) {
  return JSON.parse(readFileSync(join(root, '.forger', 'state.json'), 'utf-8'));
}

const done: BacklogData = {
  features: {
    the_ticket: {priority: 'P1', status: 'completed', depends_on: []},
    other: {priority: 'P1', status: 'completed', depends_on: []},
  },
};

function iterationLog(root: string, n: number): string {
  return readFileSync(join(root, '.forger', 'output', `iteration-${n}.log`), 'utf-8');
}

describe('AutomationRunner worker environment', () => {
  test('the worker, whose gates run the check, gets the plugin root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const calls: AgentRunOptions[] = [];
    const config = mergeConfig({});
    const runner = new AutomationRunner(root, config, backlogFrom(() => backlog, config), {
      stateStore: localStateFor(root, config),
      agent: {run: async opts => (calls.push(opts), {exitCode: 0, signal: null, output: '', timedOut: false})},
      gitRunner: sceneRunner({}, () => calls.length > 0),
      pluginRoot: '/opt/plugin',
    });
    await runner.runIteration(1);
    expect(calls[0].env?.FORGER_PLUGIN_ROOT).toBe('/opt/plugin');
    expect(calls[0].env?.FORGER_ROLE).toBe('worker');
    expect('FORGER_WORKTREE' in (calls[0].env ?? {})).toBe(false);
  });
});

describe('AutomationRunner spend limit', () => {
  const build = (limit: 'none' | 'engine') => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const calls: AgentRunOptions[] = [];
    const config = mergeConfig({});
    const runner = new AutomationRunner(root, config, backlogFrom(() => backlog, config), {
      stateStore: localStateFor(root, config),
      agent: {
        harnessId: 'copilot',
        spendLimit: () => limit,
        run: async opts => (calls.push(opts), {exitCode: 0, signal: null, output: '', timedOut: false}),
      },
      gitRunner: sceneRunner({}, () => calls.length > 0),
    });
    return {runner, root};
  };

  test('a run in a harness with no usage logs that it has no spend limit', async () => {
    const {runner, root} = build('none');
    await runner.runIteration(1);
    const log = readFileSync(join(root, '.forger', 'work.log'), 'utf-8');
    expect(log).toContain('copilot harness reports no usage for sonnet: this run has no spend limit');
    expect(runner.statusReport().runner.spendLimit).toBe('none');
  });

  test('a run whose spend the engine reads logs nothing about a missing limit', async () => {
    const {runner, root} = build('engine');
    await runner.runIteration(1);
    expect(readFileSync(join(root, '.forger', 'work.log'), 'utf-8')).not.toContain('no spend limit');
    expect(runner.statusReport().runner.spendLimit).toBe('engine');
  });
});

describe('AutomationRunner iteration log', () => {
  test('stores the resolved plan with the run and in the iteration log', async () => {
    const plan: StoredPlan = {stages: [{id: 'build', slots: [{slot: 'test_first', invoke: 'builtin', target: null}]}]};
    const asked: Array<string | null> = [];
    const {runner, root} = runnerWith({exitCode: 0, signal: null, output: '', timedOut: false}, {}, backlog, t => {
      asked.push(t);
      return plan;
    });
    await runner.runIteration(1);
    expect(asked).toEqual(['the_ticket']);
    expect(parseIterationLog(iterationLog(root, 1))?.plan).toEqual(plan);
  });

  test('a run with no plan resolver writes no plan line', async () => {
    const {runner, root} = runnerWith({exitCode: 0, signal: null, output: '', timedOut: false});
    await runner.runIteration(1);
    expect(iterationLog(root, 1)).not.toContain('plan:');
  });

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

  test('names the worker role, its ticket and its iteration in the worker environment, for its hook', async () => {
    const {runner, calls} = runnerWith({exitCode: 0, signal: null, output: '', timedOut: false});
    await runner.runIteration(1);
    const {FORGER_DEADLINE, ...identity} = calls[0].env ?? {};
    expect(identity).toEqual({FORGER_ROLE: 'worker', FORGER_TICKET: 'the_ticket', FORGER_ITERATION: '1'});
    expect(Number.isNaN(Date.parse(FORGER_DEADLINE))).toBe(false);
  });

  test('gives the agent the tier role and the model id the role maps to', async () => {
    const {runner, calls} = runnerWith({exitCode: 0, signal: null, output: '', timedOut: false});
    await runner.runIteration(1);
    expect(calls[0].tier.model).toBe('standard');
    expect(calls[0].model).toBe('sonnet');
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

describe('AutomationRunner timed-out log', () => {
  const timedOut: AgentResult = {exitCode: 1, signal: 'SIGKILL', output: 'step one\nlast words\n', timedOut: true};

  test("a timed-out run's log names the branch, last commits and PR state", async () => {
    const {runner, root} = runnerWith(timedOut, {branch: 'feat/the_ticket', prCheck: 'SUCCESS'});
    await runner.runIteration(1);
    const log = iterationLog(root, 1);
    expect(log).toContain('branch: feat/the_ticket\n');
    expect(log).toContain('last commits:\n  abc1234 third\n  def5678 second\n  9990000 first\n');
    expect(log).toContain('pr: #75 OPEN\n');
  });

  test("a timed-out run's log ends with the worker's last output", async () => {
    const {runner, root} = runnerWith(timedOut, {branch: 'feat/the_ticket'});
    await runner.runIteration(1);
    const log = iterationLog(root, 1);
    expect(log).toContain('pr: none\n');
    expect(log.endsWith('=== output ===\nstep one\nlast words\n')).toBe(true);
  });

  test('a run that did not time out prints no progress', async () => {
    const {runner, root} = runnerWith({exitCode: 0, signal: null, output: 'x', timedOut: false}, {branch: 'feat/the_ticket'});
    await runner.runIteration(1);
    expect(iterationLog(root, 1)).not.toContain('last commits');
  });
});

describe('AutomationRunner outcome from facts', () => {
  const timedOut: AgentResult = {exitCode: 1, signal: 'SIGKILL', output: '', timedOut: true};

  test('a timed-out run whose PR merged is a success and resets the failure counter', async () => {
    const {runner, root} = runnerWith(timedOut, {merge: true, branch: 'feat/the_ticket'}, done);
    writeFileSync(
      join(root, '.forger', 'state.json'),
      JSON.stringify({...defaultState(), consecutive_failures: 2, stall_count: 1})
    );

    expect(await runner.runIteration(2)).toBe(true);
    const state = readState(root);
    expect(state.status).toBe('completed');
    expect(state.stall_count).toBe(0);
    expect(state.consecutive_failures).toBe(0);
    expect(state.completed_tasks).toEqual(['the_ticket']);
  });

  test('a merge runs the delivery pack through the runner and records delivered', async () => {
    const probed: string[] = [];
    const {runner, root, calls} = runnerWith(timedOut, {merge: true, branch: 'feat/the_ticket'}, done);
    void calls;
    mkdirSync(join(root, '.forger'), {recursive: true});
    writeFileSync(join(root, '.forger', 'deliver.json'), JSON.stringify({check: 'smoke'}));
    (runner as unknown as {iteration: {probeRunner: ProbeRunner}}).iteration.probeRunner = command => (probed.push(command), {stdout: '', stderr: '', exitCode: 0});
    expect(await runner.runIteration(2)).toBe(true);
    expect(probed).toEqual(['smoke']);
    expect(readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8')).toContain('"event":"delivered"');
  });

  test('a merge without the delivery pack runs no command', async () => {
    const probed: string[] = [];
    const {runner, root} = runnerWith(timedOut, {merge: true, branch: 'feat/the_ticket'}, done);
    (runner as unknown as {iteration: {probeRunner: ProbeRunner}}).iteration.probeRunner = command => (probed.push(command), {stdout: '', stderr: '', exitCode: 0});
    expect(await runner.runIteration(2)).toBe(true);
    expect(probed).toEqual([]);
    expect(readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8')).not.toContain('deliver');
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
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
  });

  test('a merge on failing checks halts as merged_red and never counts as completed', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {merge: true, branch: 'feat/the_ticket', prCheck: 'FAILURE'},
      done
    );
    expect(await runner.runIteration(1)).toBe(false);
    const state = readState(root);
    expect(state.status).toBe('halted');
    expect(state.completed_tasks).toEqual([]);
    expect(state.last_error).toBe('PR #75 merged into main with failing check: gates. main may be red; fix it before more work lands.');
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
    const events = readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events.map(e => e.event)).toEqual(['merged_red']);
  });

  test('a merge on passing checks is a success', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {merge: true, branch: 'feat/the_ticket', prCheck: 'SUCCESS'},
      done
    );
    expect(await runner.runIteration(1)).toBe(true);
    expect(readState(root).completed_tasks).toEqual(['the_ticket']);
  });

  test('a stop claim on a run whose PR merged does not halt; the facts win', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: 'waiting on verify\n<process>stop</process>\nnot merged yet', timedOut: false},
      {merge: true, branch: 'feat/the_ticket', prCheck: 'SUCCESS'},
      done
    );
    expect(await runner.runIteration(1)).toBe(true);
    const state = readState(root);
    expect(state.status).toBe('completed');
    expect(state.completed_tasks).toEqual(['the_ticket']);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
  });

  test('a merge with no verdict for its head halts as unverified and never counts as completed', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {merge: true, branch: 'feat/the_ticket', prCheck: 'SUCCESS', verdict: 'none'},
      done
    );
    expect(await runner.runIteration(1)).toBe(false);
    const state = readState(root);
    expect(state.status).toBe('halted');
    expect(state.completed_tasks).toEqual([]);
    expect(state.last_error).toContain('PR #75 merged into main with no verdict recorded for its head');
    const events = readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events.map(e => e.event)).toEqual(['unverified']);
  });

  test('a merge whose verdict record is gone but whose head carries a passing forger/verify status counts as verified', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {merge: true, branch: 'feat/the_ticket', prCheck: 'SUCCESS', verdict: 'none', verifyStatus: 'SUCCESS'},
      done
    );
    expect(await runner.runIteration(1)).toBe(true);
    expect(readState(root).completed_tasks).toEqual(['the_ticket']);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
  });

  test('a failing forger/verify status with no record never counts as completed', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {merge: true, branch: 'feat/the_ticket', prCheck: 'SUCCESS', verdict: 'none', verifyStatus: 'FAILURE'},
      done
    );
    expect(await runner.runIteration(1)).toBe(false);
    expect(readState(root).completed_tasks).toEqual([]);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
  });

  test('stalls by merges: runs without a merge halt the loop', async () => {
    const {runner, root} = runnerWith({exitCode: 1, signal: null, output: '', timedOut: false});
    await runner.runIteration(1);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
    await runner.runIteration(2);
    expect(readState(root).last_error).toBe('Stalled: nothing merged in 2 iterations');
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
  });

  test('a branch naming no backlog ticket leaves the run held to the engine pick', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '', timedOut: false},
      {merge: true, branch: 'fix/typo'}
    );
    expect(await runner.runIteration(1)).toBe(true);
    expect(iterationLog(root, 1)).toContain('ticket: the_ticket\n');
    expect(iterationLog(root, 1)).toContain('ticket: the_ticket\nengine pick: the_ticket\n');
  });

  test('logs the ticket the worker took when it differs from the engine pick', async () => {
    const {runner, root} = runnerWith(
      {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false},
      {merge: true, branch: 'feat/other'},
      {features: {...backlog.features, other: {priority: 'P1', status: 'completed'}}}
    );
    expect(await runner.runIteration(1)).toBe(false);
    const log = iterationLog(root, 1);
    expect(log).toContain('ticket: other\nengine pick: the_ticket\n');
    expect(readState(root).status).toBe('off-pick');
    expect(readFileSync(join(root, '.forger', 'work.log'), 'utf-8')).toContain(
      'Worker took other (engine picked the_ticket)'
    );
    expect(readState(root).completed_tasks).toEqual([]);
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
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
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
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
  });

  test('resume clears counters even when no HALT file was left', () => {
    const {runner, root} = runnerWith({exitCode: 1, signal: null, output: '', timedOut: false});
    mkdirSync(join(root, '.forger'), {recursive: true});
    writeFileSync(
      join(root, '.forger', 'state.json'),
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
      join(root, '.forger', 'state.json'),
      JSON.stringify({...defaultState(), stall_count: 4})
    );
    const config = mergeConfig({
      limits: {pauseBetweenIterations: 0, pauseAfterFailure: 0, maxStallIterations: 2},
    });
    const runner = new AutomationRunner(root, config, backlogFrom(() => backlog, config), {stateStore: localStateFor(root, config), 
      agent: {run: async () => ({exitCode: 1, signal: null, output: '', timedOut: false})},
      gitRunner: () => '',
    });
    await runner.run(1);
    expect(readState(root).stall_count).toBe(0);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
  });
});

function allEventsOf(root: string): {event: string; reason: string | null; ticket: string | null; iteration: number}[] {
  const f = join(root, '.forger', 'events.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').trimEnd().split('\n').map(l => JSON.parse(l));
}

const RECORDED = ['picked', 'approval_asked', 'halt_cleared', 'contract_attempt', 'merged', 'structure_review_filed', 'access_review_filed'];

/** The terminal events only; the recorded ones have their own tests. */
function eventsOf(root: string): {event: string; reason: string | null; ticket: string | null}[] {
  return allEventsOf(root).filter(e => !RECORDED.includes(e.event));
}

describe('AutomationRunner single runner', () => {
  const fail: AgentResult = {exitCode: 1, signal: null, output: '', timedOut: false};
  const fast = mergeConfig({
    limits: {pauseBetweenIterations: 0, pauseAfterFailure: 0, maxStallIterations: 9},
  });

  function runnerIn(root: string, deps: Record<string, unknown>, data: BacklogData = backlog) {
    return new AutomationRunner(root, fast, backlogFrom(() => data, fast), {stateStore: localStateFor(root, fast), 
      agent: {run: async () => fail},
      gitRunner: () => '',
      ...deps,
    });
  }

  test('refuses while a live runner holds the lock, and starts nothing', async () => {
    const {root} = runnerWith(fail);
    writeFileSync(join(root, '.forger', 'runner.lock'), '4242');
    let spawned = 0;
    const runner = runnerIn(root, {
      isAlive: (p: number) => p === 4242,
      agent: {run: async () => {
        spawned++;
        return fail;
      }},
    });
    expect(await runner.run(1)).toBe(false);
    expect(spawned).toBe(0);
    expect(readFileSync(join(root, '.forger', 'runner.lock'), 'utf-8')).toBe('4242');
  });

  test('takes over a lock with a dead pid, and releases its own when done', async () => {
    const {root} = runnerWith(fail);
    writeFileSync(join(root, '.forger', 'runner.lock'), '4242');
    const runner = runnerIn(root, {isAlive: () => false, pid: 17});
    expect(await runner.run(1)).toBe(true);
    expect(existsSync(join(root, '.forger', 'runner.lock'))).toBe(false);
  });

  test('closes out an iteration a dead runner left open from git facts', async () => {
    const {root} = runnerWith(fail);
    writeFileSync(
      join(root, '.forger', 'state.json'),
      JSON.stringify({
        ...defaultState(),
        iteration: 4,
        status: 'running',
        in_flight: [
          {ticket: 'the_ticket', pid: null, session_id: 's1', snapshot: {baseSha: 'aaa', reflogLength: 1}, started_at: ''},
        ],
      })
    );
    let spawned = 0;
    const git = (cmd: string): string => {
      if (cmd === 'git rev-parse origin/main') return 'bbb';
      if (cmd === 'git merge-base --is-ancestor aaa bbb && echo yes') return 'yes';
      if (cmd === 'git reflog --format=%gs') return 'checkout: moving from main to feat/the_ticket\nold';
      if (cmd === 'git branch --show-current') return 'main';
      if (cmd.startsWith('gh pr view')) return 'MERGED';
      return '';
    };
    const runner = runnerIn(root, {
      gitRunner: git,
      agent: {run: async () => {
        spawned++;
        return fail;
      }},
    }, done);
    runner.closeOrphan();
    const state = readState(root);
    expect(state.status).toBe('completed');
    expect(state.completed_iterations).toBe(1);
    expect(state.completed_tasks).toEqual(['the_ticket']);
    expect(state.in_flight).toEqual([]);
    expect(spawned).toBe(0);
    expect(eventsOf(root).map(e => e.event)).toEqual(['runner_gone']);
  });

  test('an orphan with nothing merged counts as a failure, not as progress', async () => {
    const {root} = runnerWith(fail);
    writeFileSync(
      join(root, '.forger', 'state.json'),
      JSON.stringify({...defaultState(), iteration: 4, status: 'running', in_flight: [{ticket: 'the_ticket', pid: null, session_id: 's1', snapshot: null, started_at: ''}]})
    );
    const runner = runnerIn(root, {});
    runner.closeOrphan();
    const state = readState(root);
    expect(state.status).toBe('failed');
    expect(state.failed_iterations).toBe(1);
    expect(state.stall_count).toBe(0);
    expect(eventsOf(root)[0].event).toBe('runner_gone');
  });

  test('the engine pick is recorded before the worker runs', async () => {
    const {runner, root} = runnerWith(fail);
    await runner.runIteration(1);
    const picked = allEventsOf(root).filter(e => e.event === 'picked');
    expect(picked).toEqual([expect.objectContaining({iteration: 1, ticket: 'the_ticket', reason: null})]);
  });

  test('clearing a halt records who cleared what', () => {
    const {runner, root} = runnerWith(fail);
    runner.halt('by hand');
    runner.clearHalt();
    const cleared = allEventsOf(root).filter(e => e.event === 'halt_cleared');
    expect(cleared).toEqual([expect.objectContaining({reason: 'by hand'})]);
  });

  test('with a tracker, removing the halted label resumes the next start', async () => {
    let label = false;
    const tracker = {
      read: () => ({label, reason: label ? 'x' : null}),
      set: () => {
        label = true;
      },
      clear: () => {
        label = false;
      },
      writeStatus: () => {},
    };
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = fast;
    const runner = new AutomationRunner(root, config, backlogFrom(() => backlog, config), {
      stateStore: localStateFor(root, config),
      agent: {run: async () => fail},
      gitRunner: () => '',
      haltTracker: tracker,
    });
    runner.halt('boom');
    expect(label).toBe(true);
    expect(existsSync(join(root, config.paths.halt))).toBe(false);
    expect(readState(root).status).toBe('halted');
    label = false;
    await runner.run(1);
    expect(readState(root).status).not.toBe('halted');
    expect(allEventsOf(root).filter(e => e.event === 'halt_cleared')).toHaveLength(1);
  });

  test('a halt label removed by hand records an uncaused halt_cleared', async () => {
    let label = false;
    const tracker = {read: () => ({label, reason: label ? 'x' : null}), set: () => { label = true; }, clear: () => { label = false; }, writeStatus: () => {}};
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const runner = new AutomationRunner(root, fast, backlogFrom(() => backlog, fast), {stateStore: localStateFor(root, fast), agent: {run: async () => fail}, gitRunner: () => '', haltTracker: tracker});
    runner.halt('boom');
    label = false;
    await runner.run(1);
    expect(allEventsOf(root).filter(e => e.event === 'halt_cleared')).toEqual([expect.objectContaining({cause: null, not_a_defect: null})]);
  });

  test('resume with nothing halted records nothing', () => {
    const {runner, root} = runnerWith(fail);
    runner.clearHalt();
    expect(allEventsOf(root).filter(e => e.event === 'halt_cleared')).toEqual([]);
  });

  test('closeOrphan leaves a finished state alone', () => {
    const {root} = runnerWith(fail);
    const runner = runnerIn(root, {});
    runner.closeOrphan();
    expect(eventsOf(root)).toEqual([]);
  });

  test('clears the in-flight run once the iteration settles', async () => {
    const {runner, root} = runnerWith(fail);
    await runner.runIteration(1);
    expect(readState(root).in_flight).toEqual([]);
  });

  test('appends a terminal event for stall, timeout, halt, failures and completion', async () => {
    const {runner, root} = runnerWith({exitCode: 1, signal: 'SIGKILL', output: '', timedOut: true});
    await runner.runIteration(1);
    await runner.runIteration(2);
    expect(eventsOf(root).map(e => e.event)).toEqual(['timed_out', 'timed_out', 'stalled']);
    expect(eventsOf(root)[2].reason).toBe('Stalled: nothing merged in 2 iterations');

    const m = runnerWith(fail);
    m.runner.halt('by hand');
    expect(eventsOf(m.root)[0]).toMatchObject({event: 'halted', reason: 'by hand'});

    const c = runnerWith(fail);
    writeFileSync(
      join(c.root, '.forger', 'state.json'),
      JSON.stringify({...defaultState(), consecutive_failures: 3})
    );
    await runnerIn(c.root, {}).run(1);
    expect(eventsOf(c.root).map(e => e.event)).toEqual(['too_many_failures']);

    const d = runnerWith(fail);
    await runnerIn(d.root, {}, done).run(1);
    expect(eventsOf(d.root).map(e => e.event)).toEqual(['completed']);
  });

  test('statusReport carries the lock holder, current ticket and next pick', () => {
    const {root} = runnerWith(fail);
    writeFileSync(join(root, '.forger', 'runner.lock'), '4242');
    const runner = runnerIn(root, {isAlive: (p: number) => p === 4242});
    const r = runner.statusReport();
    expect(r.runner).toEqual({pid: 4242, alive: true, spendLimit: 'none'});
    expect(r.next_pick).toBe('the_ticket');
    expect(r.remaining).toBe(1);
  });
});

describe('AutomationRunner with nothing workable', () => {
  const fail: AgentResult = {exitCode: 1, signal: null, output: '', timedOut: false};
  const blockedData: BacklogData = {
    features: {
      waiting: {priority: 'P1', status: 'not_started', depends_on: ['owner_call']},
      owner_call: {priority: 'P1', status: 'needs_human'},
    },
  };

  test('spawns no agent, writes no HALT and ends with blocked_on_owner naming the blocker', async () => {
    const {runner, root, calls} = runnerWith(fail, {}, blockedData);
    await runner.run(3);
    expect(calls).toEqual([]);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
    expect(readState(root).status).not.toBe('halted');
    const events = eventsOf(root);
    expect(events.map(e => e.event)).toEqual(['blocked_on_owner']);
    expect(events[0].reason).toBe('waiting blocked by owner_call (needs_human)');
  });

  test('the parallel loop ends the same way', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = mergeConfig({parallelism: 2});
    const calls: AgentRunOptions[] = [];
    const runner = new AutomationRunner(root, config, backlogFrom(() => blockedData, config), {
      stateStore: localStateFor(root, config),
      agent: {run: async o => (calls.push(o), fail)},
      gitRunner: () => '',
    });
    await runner.run(3);
    expect(calls).toEqual([]);
    expect(eventsOf(root).map(e => e.event)).toEqual(['blocked_on_owner']);
  });
});

describe('AutomationRunner and a rate-limited backlog', () => {
  const fast = mergeConfig({
    limits: {pauseBetweenIterations: 0, pauseAfterFailure: 0, maxStallIterations: 9},
  });
  const fail: AgentResult = {exitCode: 1, signal: null, output: '', timedOut: false};

  /** A backlog whose first `limited` reads hit the rate limit, on a fake clock. */
  function limitedBacklog(limited: number, data: () => BacklogData) {
    const clock = {now: 1_000_000, slept: [] as number[], reads: 0};
    const load = (): BacklogData => {
      clock.reads++;
      if (limited-- > 0) {
        const window = {resource: 'graphql', limit: 5000, remaining: 0, resetAt: clock.now + 600_000};
        throw new RateLimitError('graphql', window, 'API rate limit already exceeded');
      }
      return data();
    };
    const deps = {
      now: () => clock.now,
      sleep: async (ms: number) => {
        clock.slept.push(ms);
        clock.now += ms;
      },
    };
    return {clock, backlog: backlogFrom(load, fast), deps};
  }

  test('waits out a rate limit after the worker run and does not charge the ticket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    let spawned = false;
    let throwsAfterRun = 0;
    const {clock, backlog: limited, deps} = limitedBacklog(0, () => {
      if (spawned && throwsAfterRun++ === 0) {
        throw new RateLimitError('graphql', {resource: 'graphql', limit: 5000, remaining: 0, resetAt: clock.now + 600_000}, 'limited');
      }
      return spawned ? done : backlog;
    });
    const runner = new AutomationRunner(root, fast, limited, {stateStore: localStateFor(root, fast), 
      ...deps,
      agent: {run: async () => {
        spawned = true;
        return {exitCode: 0, signal: null, output: '<process>complete</process>', timedOut: false};
      }},
      gitRunner: sceneRunner({merge: true, branch: 'feat/the_ticket'}, () => spawned),
    });
    expect(await runner.runIteration(1)).toBe(true);
    expect(clock.slept).toEqual([600_000 + RATE_LIMIT_MARGIN_MS]);
    const state = readState(root);
    expect(state.status).toBe('completed');
    expect(state.consecutive_failures).toBe(0);
    expect(state.failed_iterations).toBe(0);
    expect(state.completed_tasks).toEqual(['the_ticket']);
  });

  test('waits out a rate limit at start, then counts only the worker failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const {clock, backlog: limited, deps} = limitedBacklog(2, () => backlog);
    const runner = new AutomationRunner(root, fast, limited, {stateStore: localStateFor(root, fast), ...deps, agent: {run: async () => fail}, gitRunner: () => ''});
    await runner.run(1);
    expect(clock.slept.filter(ms => ms > 0)).toEqual([600_000 + RATE_LIMIT_MARGIN_MS, 600_000 + RATE_LIMIT_MARGIN_MS]);
    const state = readState(root);
    expect(state.consecutive_failures).toBe(1);
    expect(state.last_error).not.toContain('rate_limit');
  });

  test('reads the backlog once at start and once per iteration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const {clock, backlog: counted, deps} = limitedBacklog(0, () => backlog);
    const runner = new AutomationRunner(root, fast, counted, {stateStore: localStateFor(root, fast), ...deps, agent: {run: async () => fail}, gitRunner: () => ''});
    await runner.run(2);
    expect(clock.reads).toBe(1 + 2);
  });

  test('an error that is not a rate limit is not waited out', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const runner = new AutomationRunner(
      root,
      fast,
      backlogFrom(() => {
        throw new Error('GitHub backlog: gh exited 1 with no output, nothing on stderr');
      }, fast),
      {stateStore: memoryStateStore(), agent: {run: async () => fail}, gitRunner: () => '', sleep: async () => {
        throw new Error('must not wait');
      }}
    );
    await expect(runner.refreshBacklog()).rejects.toThrow(/GitHub backlog/);
  });

  test('watch re-reads the backlog only every so many redraws, and reports a failed read', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    let reads = 0;
    let failing = false;
    const runner = new AutomationRunner(
      root,
      fast,
      backlogFrom(() => {
        reads++;
        if (failing) throw new Error('offline');
        return backlog;
      }, fast),
      {stateStore: memoryStateStore(), gitRunner: () => ''}
    );
    for (let redraw = 1; redraw < WATCH_BACKLOG_EVERY; redraw++) expect(runner.watchRefresh(redraw)).toBeNull();
    expect(reads).toBe(0);
    expect(runner.watchRefresh(WATCH_BACKLOG_EVERY)).toBeNull();
    expect(reads).toBe(1);
    failing = true;
    expect(runner.watchRefresh(2 * WATCH_BACKLOG_EVERY)).toBe('offline');
  });
});

describe('AutomationRunner declines', () => {
  const two: BacklogData = {
    features: {
      the_ticket: {priority: 'P1', status: 'not_started', depends_on: []},
    },
  };

  function decliningRunner() {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = mergeConfig({limits: {maxStallIterations: 50}});
    const runner = new AutomationRunner(root, config, backlogFrom(() => two, config), {stateStore: localStateFor(root, config), 
      agent: {run: async () => {
        mkdirSync(join(root, '.forger'), {recursive: true});
        writeFileSync(
          join(root, '.forger', 'declined.json'),
          JSON.stringify({ticket: 'the_ticket', reason: 'unclear', detail: 'which one?', at: 't'})
        );
        return {exitCode: 0, signal: null, output: '<process>stop</process> unclear', timedOut: false};
      }},
      gitRunner: sceneRunner({}, () => true),
      uuid: () => '00000000-0000-0000-0000-000000000000',
    });
    return {runner, root};
  }

  test('a decline of the pick is neutral, recorded, and the record is consumed', async () => {
    const {runner, root} = decliningRunner();
    expect(await runner.runIteration(1)).toBe(false);
    const state = readState(root);
    expect(state.status).toBe('declined');
    expect(state.consecutive_failures).toBe(0);
    expect(state.stall_count).toBe(1);
    expect(state.declined_tasks).toEqual([{ticket: 'the_ticket', reason: 'unclear', iteration: 1}]);
    expect(existsSync(join(root, '.forger', 'declined.json'))).toBe(false);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
  });

  test('two declines in a row do not halt; the third does, naming each ticket', async () => {
    const {runner, root} = decliningRunner();
    await runner.runIteration(1);
    await runner.runIteration(2);
    expect(readState(root).consecutive_declines).toBe(2);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
    await runner.runIteration(3);
    expect(readState(root).consecutive_declines).toBe(3);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
    expect(readFileSync(join(root, '.forger', 'HALT'), 'utf-8')).toContain('Declined 3 tickets in a row: the_ticket (unclear), the_ticket (unclear), the_ticket (unclear)');
  });

  test('a stale record from an earlier run does not decline this one', async () => {
    const {runner, root, calls} = runnerWith({exitCode: 0, signal: null, output: '<process>stop</process> x', timedOut: false});
    mkdirSync(join(root, '.forger'), {recursive: true});
    writeFileSync(join(root, '.forger', 'declined.json'), JSON.stringify({ticket: 'the_ticket', reason: 'blocked', detail: 'old', at: 't'}));
    await runner.runIteration(1);
    expect(calls).toHaveLength(1);
    expect(readState(root).status).toBe('set-aside');
    expect(readState(root).declined_tasks).toEqual([]);
  });
});

describe('AutomationRunner pre-pick refusal', () => {
  test('relabels and comments on an uncheckable GitHub ticket, skips a checkable one, and records no decline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = mergeConfig({tracker: {kind: 'github', label: 'ready-for-agent'}});
    const data = {
      features: {
        'issue-1': {priority: 'P1', status: 'not_started', depends_on: [], body: '## Acceptance\n- [ ] It feels nice'},
        'issue-2': {priority: 'P1', status: 'not_started', depends_on: [], body: '## Acceptance\n- [ ] `bun run check` exits 0'},
      },
    } as unknown as BacklogData;
    const commands: string[] = [];
    const runner = new AutomationRunner(root, config, backlogFrom(() => data, config), {
      stateStore: localStateFor(root, config),
      agent: {run: async () => ({exitCode: 0, signal: null, output: '', timedOut: false})},
      gitRunner: cmd => (commands.push(cmd), cmd.includes('--json labels') ? 'needs-info\n' : ''),
    });
    await runner.refuseUncheckable();
    expect(commands.some(c => c.includes('gh issue edit 1') && c.includes('--add-label needs-info') && c.includes("--remove-label 'ready-for-agent'"))).toBe(true);
    expect(commands.some(c => c.includes('gh issue comment 1') && c.includes('It feels nice'))).toBe(true);
    expect(commands.some(c => / 2( |$)/.test(c) && c.startsWith('gh issue'))).toBe(false);
    const state = runner['store'].load();
    expect(state.declined_tasks).toEqual([]);
    expect(state.consecutive_declines).toBe(0);
  });

  test('a local tracker is never checked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = mergeConfig({});
    const commands: string[] = [];
    const runner = new AutomationRunner(root, config, backlogFrom(() => backlog, config), {
      stateStore: localStateFor(root, config),
      agent: {run: async () => ({exitCode: 0, signal: null, output: '', timedOut: false})},
      gitRunner: cmd => (commands.push(cmd), ''),
    });
    await runner.refuseUncheckable();
    expect(commands).toEqual([]);
  });
});

describe('a ticket Probe', () => {
  const probeBacklog = (probe: string): BacklogData => ({
    features: {'issue-5': {priority: 'P1', status: 'not_started', depends_on: [], body: `## Acceptance\n\n- [ ] \`bun test\` exits 0\n\n## Probe\n\n${probe}\n`}},
  });

  function probed(probe: string, probeRunner: ProbeRunner) {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const calls: AgentRunOptions[] = [];
    const tracker: string[] = [];
    const config = mergeConfig({tracker: {kind: 'github', label: 'ready-for-agent', ignore: []}});
    const runner = new AutomationRunner(root, config, backlogFrom(() => probeBacklog(probe), config), {
      stateStore: localStateFor(root, config),
      agent: {run: async opts => (calls.push(opts), {exitCode: 0, signal: null, output: '', timedOut: false})},
      gitRunner: cmd => {
        tracker.push(cmd);
        return cmd.startsWith('gh issue view') ? 'needs-human' : '';
      },
      probeRunner,
      uuid: () => '00000000-0000-0000-0000-000000000000',
    });
    return {runner, root, calls, tracker};
  }

  test('a ticket whose probes hold starts its worker with the probe output in the prompt', async () => {
    const {runner, calls} = probed('- `measure` prints a number of at least 40', () => ({stdout: '48', stderr: '', exitCode: 0}));
    await runner.runIteration(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('## Probe output');
    expect(calls[0].prompt).toContain('exit 0, output: 48');
  });

  test('a failed probe starts no worker, comments the expected and actual result, and labels needs-human', async () => {
    const {runner, root, calls, tracker} = probed('- `measure` prints a number of at least 40', () => ({stdout: '32', stderr: '', exitCode: 0}));
    await runner.runIteration(1);
    expect(calls).toHaveLength(0);
    expect(tracker).toContain('gh issue edit 5 --add-label needs-human');
    const comment = tracker.find(c => c.startsWith('gh issue comment 5'))!;
    expect(comment).toContain('`measure`');
    expect(comment).toContain('prints a number of at least 40');
    expect(comment).toContain('exit 0, output: 32');
    expect(tracker).toContain("gh issue edit 5 --remove-label 'ready-for-agent'");
    expect(allEventsOf(root).map(e => e.event)).toContain('probe_failed');
  });

  test('a failed probe does not count as a worker failure', async () => {
    const {runner, root} = probed('- `measure` exits 0', () => ({stdout: '', stderr: '', exitCode: 1}));
    await runner.runIteration(1);
    const state = readState(root);
    expect(state.failed_iterations).toBe(0);
    expect(state.consecutive_failures).toBe(0);
    expect(state.stall_count).toBe(0);
    expect(state.status).toBe('ready');
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
    expect(state.in_flight).toEqual([]);
  });
});

describe('AutomationRunner on a conflict stop', () => {
  const block = (recommend: string) =>
    `<process>stop conflict</process>\nconstraint: footer fits\nmeasured: 18 px over\noption: A - shrink\ntradeoff: small type\noption: B - wrap\ntradeoff: taller\nrecommend: ${recommend}\n`;
  const reply = (output: string): AgentResult => ({exitCode: 0, signal: null, output, timedOut: false});

  async function run(outputs: string[]) {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = mergeConfig({tracker: {kind: 'github', label: 'ready-for-agent'}});
    const data = {features: {'issue-5': {priority: 'P1', status: 'not_started', depends_on: [], body: '## Acceptance\n- [ ] `bun run check` exits 0'}}} as unknown as BacklogData;
    const commands: string[] = [];
    const prompts: string[] = [];
    const runner = new AutomationRunner(root, config, backlogFrom(() => data, config), {
      stateStore: localStateFor(root, config),
      agent: {run: async o => (prompts.push(o.prompt), reply(outputs[Math.min(prompts.length, outputs.length) - 1]))},
      gitRunner: cmd => (commands.push(cmd), ''),
    });
    await runner.runIteration(1);
    return {commands, prompts, state: readState(root)};
  }

  test('a conflict stop sets the ticket aside, labels it and posts the options', async () => {
    const r = await run([block('B')]);
    expect(r.prompts).toHaveLength(1);
    expect(r.commands.some(c => c.includes('gh issue edit 5 --add-label needs-human'))).toBe(true);
    expect(r.commands.some(c => c.startsWith('gh issue comment 5') && c.includes('Answer with: decide 5'))).toBe(true);
    expect(r.state.status).toBe('set-aside');
    expect(r.state.set_aside_tasks.map((e: {ticket: string}) => e.ticket)).toEqual(['issue-5']);
  });

  test('an incomplete block is asked for once more and the second one is used', async () => {
    const r = await run([block('C'), block('A')]);
    expect(r.prompts).toHaveLength(2);
    expect(r.prompts[1]).toContain('recommend "C" names no listed option');
    expect(r.commands.some(c => c.includes('--add-label needs-human'))).toBe(true);
  });

  test('a block incomplete twice is an ordinary stop: set aside with the reason, no options', async () => {
    const r = await run([block('C'), block('C')]);
    expect(r.prompts).toHaveLength(2);
    expect(r.commands.some(c => c.includes('--add-label needs-human'))).toBe(true);
    expect(r.commands.some(c => c.startsWith('gh issue comment 5') && c.includes('Reason:') && !c.includes('Options:'))).toBe(true);
    expect(r.state.status).toBe('set-aside');
  });

  test('a second answer with no block at all is an ordinary stop', async () => {
    const r = await run([block('C'), 'sorry']);
    expect(r.commands.some(c => c.startsWith('gh issue comment 5') && !c.includes('Options:'))).toBe(true);
  });
});

describe('AutomationRunner on an engine_changed event', () => {
  function refusedRunner(declines: boolean) {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = mergeConfig({limits: {maxStallIterations: 50}});
    const data = {features: {the_ticket: {priority: 'P1', status: 'not_started', depends_on: []}}} as BacklogData;
    const runner = new AutomationRunner(root, config, backlogFrom(() => data, config), {
      stateStore: localStateFor(root, config),
      agent: {run: async () => {
        mkdirSync(join(root, '.forger'), {recursive: true});
        const event = {event: 'engine_changed', at: 't', iteration: 1, ticket: 'the_ticket', reason: 'merge: engine/a.ts, engine/b.ts'};
        writeFileSync(join(root, '.forger', 'events.jsonl'), `${JSON.stringify(event)}\n`);
        if (declines) writeFileSync(join(root, '.forger', 'declined.json'), JSON.stringify({ticket: 'the_ticket', reason: 'blocked', detail: 'refused', at: 't'}));
        return {exitCode: 0, signal: null, output: '<process>stop</process> the engine checkout changed', timedOut: false};
      }},
      gitRunner: sceneRunner({}, () => true),
      uuid: () => '00000000-0000-0000-0000-000000000000',
    });
    return {runner, root};
  }

  test('an iteration with an engine_changed event for its ticket halts the loop and the reason names the paths', async () => {
    const {runner, root} = refusedRunner(false);
    await runner.runIteration(1);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
    const halt = readFileSync(join(root, '.forger', 'HALT'), 'utf-8');
    expect(halt).toContain('engine/a.ts, engine/b.ts');
    expect(halt).toContain('Commit or discard');
  });

  test('an iteration with an engine_changed event sets no ticket aside and counts no failure, stall or decline', async () => {
    const {runner, root} = refusedRunner(false);
    await runner.runIteration(1);
    const state = readState(root);
    expect(state.set_aside_tasks).toEqual([]);
    expect(state.consecutive_set_asides).toBe(0);
    expect(state.consecutive_failures).toBe(0);
    expect(state.failed_iterations).toBe(0);
    expect(state.stall_count).toBe(0);
    expect(state.declined_tasks).toEqual([]);
    expect(state.consecutive_declines).toBe(0);
  });

  test('a decline recorded in an iteration with an engine_changed event is dropped', async () => {
    const {runner, root} = refusedRunner(true);
    await runner.runIteration(1);
    const state = readState(root);
    expect(state.declined_tasks).toEqual([]);
    expect(state.consecutive_declines).toBe(0);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
  });
});

describe('AutomationRunner on a worker stop', () => {
  const knock = (paths: string): string => `## Acceptance\n- [ ] \`bun run check\` exits 0\n\n## Knock-on\n\n${paths}\n`;
  const ticket = (priority: string, paths: string) => ({priority, status: 'not_started', depends_on: [] as string[], body: knock(paths)});

  function setup(features: Record<string, unknown>, limits: Record<string, number> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
    dirs.push(root);
    const config = mergeConfig({tracker: {kind: 'github', label: 'ready-for-agent'}, limits: {maxStallIterations: 50, ...limits}});
    const data = {features} as unknown as BacklogData;
    const commands: string[] = [];
    const backlog = backlogFrom(() => data, config);
    const runner = new AutomationRunner(root, config, backlog, {
      stateStore: localStateFor(root, config),
      agent: {run: async () => ({exitCode: 0, signal: null, output: '<process>stop</process> needs a key', timedOut: false})},
      gitRunner: cmd => (commands.push(cmd), ''),
    });
    return {runner, root, backlog, commands};
  }

  test('a worker stop sets the ticket aside and does not halt', async () => {
    const {runner, root, commands} = setup({'issue-5': ticket('P1', '`src/a.ts`')});
    expect(await runner.runIteration(1)).toBe(false);
    const state = readState(root);
    expect(state.status).toBe('set-aside');
    expect(state.consecutive_failures).toBe(0);
    expect(state.set_aside_tasks.map((e: {ticket: string; reason: string}) => [e.ticket, e.reason])).toEqual([['issue-5', 'needs a key']]);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
    expect(commands).toContain('gh issue edit 5 --add-label needs-human');
    expect(commands.some(c => c.startsWith('gh issue comment 5') && c.includes('needs a key'))).toBe(true);
    const recorded = readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8');
    expect(recorded).toContain('"event":"set_aside"');
  });

  test('the pick after a set-aside skips a ticket that shares its footprint', async () => {
    const {runner, backlog} = setup({
      'issue-5': ticket('P1', '`src/loop/a.ts`'),
      'issue-6': ticket('P1', '`src/loop/b.ts`\n`src/loop`'),
      'issue-7': ticket('P2', '`src/other/c.ts`'),
    });
    expect(backlog.next()).toBe('issue-5');
    await runner.runIteration(1);
    expect(backlog.next()).toBe('issue-7');
    expect(backlog.candidates().map(c => c.id)).toEqual(['issue-7']);
    expect(backlog.report().workable.map(w => w.id)).toEqual(['issue-7']);
  });

  test('maxSetAside tickets set aside in a row halts the loop', async () => {
    const {runner, root} = setup(
      {'issue-5': ticket('P1', '`src/a.ts`'), 'issue-6': ticket('P1', '`src/b.ts`')},
      {maxSetAside: 2}
    );
    await runner.runIteration(1);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
    await runner.runIteration(2);
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
    expect(readFileSync(join(root, '.forger', 'HALT'), 'utf-8')).toContain('Set aside 2 tickets in a row');
  });

  test('resume clears the count of set-asides', async () => {
    const {runner, root, backlog} = setup({'issue-5': ticket('P1', '`src/a.ts`'), 'issue-6': ticket('P1', '`src/a.ts`')});
    await runner.runIteration(1);
    expect(backlog.next()).toBeNull();
    runner.clearHalt();
    expect(readState(root).consecutive_set_asides).toBe(0);
  });
});
