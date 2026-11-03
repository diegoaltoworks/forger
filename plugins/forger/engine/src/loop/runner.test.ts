import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {type BacklogData, backlogFrom} from '../backlog';
import type {AgentResult, AgentRunOptions} from '../ports';
import {mergeConfig} from '../config';
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
    if (scene.branch && scene.prCheck && cmd === `gh pr view ${scene.branch} --json number,state,mergedAt,statusCheckRollup,headRefOid`) {
      return JSON.stringify({
        number: 75,
        headRefOid: 'head75',
        state: after && scene.merge ? 'MERGED' : 'OPEN',
        statusCheckRollup: [{__typename: 'CheckRun', name: 'gates', status: 'COMPLETED', conclusion: scene.prCheck}],
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
  data: BacklogData = backlog
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
  const runner = new AutomationRunner(root, config, backlogFrom(() => data, config), {
    agent: {run: async opts => {
      calls.push(opts);
      return result;
    }},
    gitRunner: sceneRunner(scene, () => calls.length > 0),
    uuid: () => '00000000-0000-0000-0000-000000000000',
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
    const runner = new AutomationRunner(root, config, backlogFrom(() => backlog, config), {
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

const RECORDED = ['picked', 'approval_asked', 'halt_cleared'];

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
    return new AutomationRunner(root, fast, backlogFrom(() => data, fast), {
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
    expect(r.runner).toEqual({pid: 4242, alive: true});
    expect(r.next_pick).toBe('the_ticket');
    expect(r.remaining).toBe(1);
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
    const runner = new AutomationRunner(root, fast, limited, {
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
    const runner = new AutomationRunner(root, fast, limited, {...deps, agent: {run: async () => fail}, gitRunner: () => ''});
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
    const runner = new AutomationRunner(root, fast, counted, {...deps, agent: {run: async () => fail}, gitRunner: () => ''});
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
      {agent: {run: async () => fail}, gitRunner: () => '', sleep: async () => {
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
      {gitRunner: () => ''}
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
    const runner = new AutomationRunner(root, config, backlogFrom(() => two, config), {
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
    expect(readState(root).status).toBe('halted');
    expect(readState(root).declined_tasks).toEqual([]);
  });
});
