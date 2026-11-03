import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {main} from './cli';
import type {CommandRunner} from './git';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function projectWith(
  features: Record<string, unknown>,
  tracker: Record<string, unknown> = {kind: 'local'}
): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
  dirs.push(root);
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'backlog.json'), JSON.stringify({features}));
  writeFileSync(join(root, '.claude', 'workloop.config.json'), JSON.stringify({tracker}));
  return root;
}

async function capture(argv: string[], run?: CommandRunner, installedSkills?: () => string[]): Promise<string> {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  try {
    await main(argv, {run, installedSkills});
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('status --json', () => {
  test('reports the runner, halt, counters, current ticket and next pick', async () => {
    process.chdir(projectWith({a: {status: 'not_started', priority: 'P0'}}));
    const out = JSON.parse(await capture(['status', '--json']));
    expect(out.runner).toEqual({pid: null, alive: false});
    expect(out.halted).toBe(false);
    expect(out.next_pick).toBe('a');
    expect(out.current_ticket).toBeNull();
    expect(out.counters.max_stall_iterations).toBe(5);
    expect(out.remaining).toBe(1);
  });
});

describe('backlog --json', () => {
  test('prints the workable tickets in order, the remaining count and the next pick', async () => {
    process.chdir(
      projectWith({
        blocked: {status: 'not_started', priority: 'P0', depends_on: ['b']},
        b: {status: 'not_started', priority: 'P1'},
        a: {status: 'not_started', priority: 'P0'},
        done: {status: 'completed', priority: 'P0'},
      })
    );
    const out = JSON.parse(await capture(['backlog', '--json']));
    expect(out).toEqual({
      workable: [
        {id: 'a', priority: 'P0'},
        {id: 'b', priority: 'P1'},
      ],
      remaining: 3,
      next: 'a',
    });
  });

  test('an empty backlog reports nothing to do', async () => {
    process.chdir(projectWith({done: {status: 'completed'}}));
    const out = JSON.parse(await capture(['backlog', '--json']));
    expect(out).toEqual({workable: [], remaining: 0, next: null});
  });

  test('with tracker.kind github, lists tickets from issues, not backlog.json', async () => {
    process.chdir(
      projectWith({from_file: {status: 'not_started', priority: 'P0'}}, {kind: 'github', label: 'go'})
    );
    const issue = (number: number, labels: string[], blockedBy: unknown[] = []) => ({
      number,
      state: 'OPEN',
      labels: {nodes: labels.map(name => ({name}))},
      timelineItems: {nodes: []},
      blockedBy: {nodes: blockedBy},
    });
    const response = JSON.stringify([
      {
        data: {
          repository: {
            issues: {
              nodes: [
                issue(5, ['go', 'P1']),
                issue(6, ['go', 'P0'], [issue(5, ['go'])]),
                issue(7, ['go', 'P2']),
              ],
            },
          },
        },
      },
    ]);
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      return response;
    };
    const out = JSON.parse(await capture(['backlog', '--json'], run));
    expect(out).toEqual({
      workable: [
        {id: 'issue-5', priority: 'P1'},
        {id: 'issue-7', priority: 'P2'},
      ],
      remaining: 3,
      next: 'issue-5',
    });
    expect(calls.every(c => c.startsWith('gh api graphql'))).toBe(true);
  });
});

describe('check docs', () => {
  test('prints file:line and rule and sets a failing exit code on a violation', async () => {
    const root = projectWith({});
    process.chdir(root);
    const out = await capture(['check', 'docs'], () => 'a.md');
    writeFileSync(join(root, 'a.md'), 'x');
    expect(out).toBe('docs check: clean');
    writeFileSync(join(root, 'a.md'), 'bad \u2014');
    const bad = await capture(['check', 'docs', '--json'], () => 'a.md');
    expect(JSON.parse(bad)).toEqual([{file: 'a.md', line: 1, rule: 'non-ascii', detail: 'U+2014'}]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('setup --json', () => {
  test('reports each file as written, then as kept on the second run', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    const first = JSON.parse(await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local']));
    expect(first.files.map((f: {action: string}) => f.action)).not.toContain('kept');
    const config = JSON.parse(readFileSync(join(root, '.claude', 'workloop.config.json'), 'utf-8'));
    expect(config.tracker.kind).toBe('local');
    const second = JSON.parse(await capture(['setup', '--json']));
    expect(second.files.map((f: {action: string}) => f.action)).not.toContain('written');
  });
});

describe('skills --json', () => {
  test('resolves each slot from the config against the installed skills', async () => {
    const root = projectWith({});
    writeFileSync(
      join(root, '.claude', 'workloop.config.json'),
      JSON.stringify({tracker: {kind: 'local'}, skills: {review: 'c:review', diagnose: 'c:gone'}})
    );
    process.chdir(root);
    const out = JSON.parse(await capture(['skills', '--json'], undefined, () => ['c:review']));
    const by = Object.fromEntries(out.slots.map((s: {slot: string}) => [s.slot, s]));
    expect(by.review).toMatchObject({skill: 'c:review', installed: true, use: 'skill'});
    expect(by.diagnose).toMatchObject({skill: 'c:gone', installed: false, use: 'builtin'});
    expect(by.interview).toMatchObject({skill: null, use: 'builtin'});
  });
  test('--presets lists the presets whose collection is installed', async () => {
    process.chdir(projectWith({}));
    const hit = JSON.parse(await capture(['skills', '--presets', '--json'], undefined, () => ['mattpocock-skills:tdd']));
    expect(hit.map((p: {name: string}) => p.name)).toEqual(['mattpocock-skills']);
    expect(JSON.parse(await capture(['skills', '--presets', '--json'], undefined, () => []))).toEqual([]);
  });
});

describe('setup --preset', () => {
  test('writes the preset into the new config and offers it when installed', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
    dirs.push(root);
    mkdirSync(join(root, '.claude'));
    process.chdir(root);
    const out = JSON.parse(await capture(['setup', '--json', '--preset', 'mattpocock-skills'], undefined, () => ['mattpocock-skills:tdd']));
    expect(out.presets).toEqual(['mattpocock-skills']);
    const config = JSON.parse(readFileSync(join(root, '.claude', 'workloop.config.json'), 'utf-8'));
    expect(config.skills.review).toBe('mattpocock-skills:code-review');
  });
  test('an unknown preset fails without writing', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
    dirs.push(root);
    process.chdir(root);
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['setup', '--preset', 'nope'], undefined, () => []);
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      process.exitCode = 0;
    }
  });
});

describe('supervisor commands', () => {
  test('orient starts a runner when work remains and none is alive', async () => {
    process.chdir(projectWith({a: {status: 'not_started', priority: 'P0'}}));
    const out = JSON.parse(await capture(['orient', '--json'], () => 'main'));
    expect(out.action).toBe('start');
    expect(out.anomalies).toEqual([]);
  });

  test('orient surfaces a halt with the reason from the HALT file', async () => {
    const root = projectWith({a: {status: 'not_started'}});
    writeFileSync(join(root, '.claude', 'HALT'), 'cut off before merge');
    process.chdir(root);
    const out = JSON.parse(await capture(['orient', '--json'], () => 'main'));
    expect(out.action).toBe('surface_halt');
    expect(out.reason).toBe('cut off before merge');
  });

  test('report names the real checked-out branch as an anomaly when no runner is alive', async () => {
    process.chdir(projectWith({a: {status: 'not_started'}}));
    const out = JSON.parse(await capture(['report', '--json'], () => 'feat/a'));
    expect(out.waiting_on_owner[0].question).toContain('feat/a');
    expect(out.next).toEqual(['a']);
  });

  test('approval answers from the table without a project', async () => {
    process.chdir(tmpdir());
    expect(await capture(['approval', 'clear_halt'])).toBe('owner');
    expect(await capture(['approval', 'start_runner'])).toBe('alone');
  });

  test('events lists what the runner wrote', async () => {
    const root = projectWith({});
    writeFileSync(
      join(root, '.claude', 'events.jsonl'),
      '{"event":"completed","at":"2000-01-01T00:00:00.000Z","iteration":1,"ticket":null,"reason":null}\n'
    );
    process.chdir(root);
    const out = JSON.parse(await capture(['events', '--json']));
    expect(out.map((e: {event: string}) => e.event)).toEqual(['completed']);
  });
});
