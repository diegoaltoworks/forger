import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {main} from './main';
import type {CommandRunner} from '../ports';

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
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker}));
  return root;
}

async function capture(argv: string[], run?: CommandRunner, installedSkills?: () => string[], collectionRoots?: () => string[]): Promise<string> {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  try {
    await main(argv, {run, installedSkills, collectionRoots});
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
      anomalies: [],
    });
  });

  test('an empty backlog reports nothing to do', async () => {
    process.chdir(projectWith({done: {status: 'completed'}}));
    const out = JSON.parse(await capture(['backlog', '--json']));
    expect(out).toEqual({workable: [], remaining: 0, next: null, anomalies: []});
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
      anomalies: [],
    });
    expect(calls.every(c => c.startsWith('gh api graphql'))).toBe(true);
  });
});

describe('link-blockers', () => {
  test('links the blockers the body names, through the runner', async () => {
    process.chdir(projectWith({a: {status: 'not_started'}}));
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      const n = cmd.match(/-F number=(\d+)/)?.[1];
      if (n === '7') return JSON.stringify({data: {repository: {issue: {id: 'I7', body: '## Blocked by\n\n- #5', blockedBy: {nodes: []}}}}});
      if (n === '5') return JSON.stringify({data: {repository: {issue: {id: 'I5', body: '', blockedBy: {nodes: []}}}}});
      return '{}';
    };
    const out = JSON.parse(await capture(['link-blockers', '--issue', '7', '--json'], run));
    expect(out).toEqual({issue: 7, linked: [5], already: []});
    expect(calls.filter(c => c.includes('addBlockedBy'))).toHaveLength(1);
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
    expect(JSON.parse(bad)).toEqual([{file: 'a.md', line: 1, rule: 'non-ascii', opinion: 'base.ascii-punctuation', detail: 'U+2014'}]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('check decisions', () => {
  test('fails on a layer map change with no ADR; an ADR in the diff passes', async () => {
    process.chdir(projectWith({}));
    const run = (extra: string): CommandRunner => cmd => (cmd.startsWith('git merge-base') ? 'abc' : cmd.startsWith('git diff') ? `M\t.forger/architecture.json${extra}` : '');
    const bad = await capture(['check', 'decisions', '--json'], run(''));
    expect(JSON.parse(bad).map((f: {rule: string}) => f.rule)).toEqual(['layer-map-without-adr']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(await capture(['check', 'decisions'], run('\nA\tdocs/adr/0001-x.md'))).toBe('decisions check: clean');
  });
});

describe('check safety', () => {
  test('fails on an added env file and passes on a clean branch', async () => {
    const root = projectWith({});
    process.chdir(root);
    writeFileSync(join(root, '.forger', 'safety.json'), '{"migration_paths":["db/**"],"data_test_paths":["tests/**"]}');
    writeFileSync(join(root, '.env'), 'A=1\n');
    const run = (untracked: string): CommandRunner => cmd => (cmd.startsWith('git merge-base') ? 'abc' : cmd.startsWith('git ls-files') ? untracked : '');
    const bad = await capture(['check', 'safety', '--json'], run('.env'));
    expect(JSON.parse(bad).map((f: {rule: string}) => f.rule)).toEqual(['env-file']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(await capture(['check', 'safety'], run(''))).toBe('safety check: clean');
  });
});

describe('check coverage', () => {
  const setup = () => {
    const root = projectWith({});
    process.chdir(root);
    writeFileSync(join(root, '.forger', 'testing.json'), JSON.stringify({test_paths: ['**/*.test.ts'], integration_paths: ['e2e/**'], network_modules: ['http'], coverage_report: 'lcov.info', coverage_baseline: 'base.json'}));
    writeFileSync(join(root, 'lcov.info'), 'LF:10\nLH:9\n');
    return root;
  };

  test('--update writes the baseline, then the check passes and a drop fails', async () => {
    const root = setup();
    expect(await capture(['check', 'coverage', '--update'])).toBe('coverage baseline: raised to 90.00%');
    expect(JSON.parse(readFileSync(join(root, 'base.json'), 'utf-8'))).toEqual({line_coverage: 90});
    expect(await capture(['check', 'coverage'])).toBe('coverage check: clean');
    writeFileSync(join(root, 'lcov.info'), 'LF:10\nLH:8\n');
    expect(JSON.parse(await capture(['check', 'coverage', '--json'])).map((f: {rule: string}) => f.rule)).toEqual(['coverage-dropped']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(await capture(['check', 'coverage', '--update', '--json'])).toBe('{"updated":false,"line_coverage":null}');
  });
});

describe('check tests', () => {
  test('fails a fix commit with no test change', async () => {
    const root = projectWith({});
    process.chdir(root);
    writeFileSync(join(root, '.forger', 'testing.json'), JSON.stringify({test_paths: ['**/*.test.ts'], integration_paths: ['e2e/**'], network_modules: ['http'], coverage_report: 'lcov.info', coverage_baseline: 'base.json'}));
    const run: CommandRunner = cmd => (cmd.startsWith('git merge-base') ? 'abc' : cmd.startsWith('git log') ? 'fix: a' : '');
    const out = JSON.parse(await capture(['check', 'tests', '--json'], run));
    expect(out.map((f: {rule: string}) => f.rule)).toEqual(['fix-without-test']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('check arch', () => {
  const map = JSON.stringify({layers: [{name: 'core', paths: ['core/**']}, {name: 'shell', paths: ['shell/**']}], allow: {shell: ['core']}});

  test('reports the forbidden import and fails; clean passes', async () => {
    const root = projectWith({});
    process.chdir(root);
    mkdirSync(join(root, 'core'));
    mkdirSync(join(root, 'shell'));
    writeFileSync(join(root, '.forger', 'architecture.json'), map);
    writeFileSync(join(root, 'shell/s.ts'), '');
    writeFileSync(join(root, 'core/c.ts'), "import '../shell/s';");
    const bad = await capture(['check', 'arch', '--json'], () => 'core/c.ts\nshell/s.ts');
    expect(JSON.parse(bad).map((f: {file: string; opinion: string}) => [f.file, f.opinion])).toEqual([['core/c.ts', 'architecture.dependency-rule']]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(await capture(['check', 'arch'], () => 'shell/s.ts')).toBe('arch check: clean');
  });

  test('a missing layer map fails loudly', async () => {
    process.chdir(projectWith({}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['check', 'arch'], () => '');
    expect(err.mock.calls[0][0]).toContain('architecture.json not found');
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('check', () => {
  function installed(): string {
    const root = projectWith({});
    writeFileSync(join(root, '.forger', 'forger.lock.json'), JSON.stringify({packs: [{id: 'base', version: '1.1.0', files: []}]}));
    writeFileSync(join(root, 'a.md'), 'clean');
    process.chdir(root);
    return root;
  }

  test('all clean: every check passed, exit 0', async () => {
    installed();
    const report = JSON.parse(await capture(['check', '--json'], () => 'a.md'));
    expect(report).toEqual({
      ok: true,
      gaps: [],
      results: [{check: 'docs', opinions: ['base.ascii-punctuation', 'base.nothing-personal', 'base.no-hard-coded-skills', 'base.model-agnostic', 'base.merge-through-tool'], status: 'passed', violations: [], waived: [], gaps: []}],
      waivers: [],
      staleWaivers: [],
    });
    expect(process.exitCode).not.toBe(1);
  });

  test('--summary prints the CI job summary in markdown', async () => {
    installed();
    const out = await capture(['check', '--summary'], () => 'a.md');
    expect(out).toContain('## forger check: passed');
    expect(out).toContain('| docs | `base.ascii-punctuation`, `base.nothing-personal`, `base.no-hard-coded-skills`, `base.model-agnostic`, `base.merge-through-tool` | passed | 0 | 0 |');
  });

  test('one violation: failed, carries the opinion id, exit 1', async () => {
    const root = installed();
    writeFileSync(join(root, 'a.md'), 'bad \u2014');
    const report = JSON.parse(await capture(['check', '--json'], () => 'a.md'));
    expect(report.ok).toBe(false);
    expect(report.results[0].status).toBe('failed');
    expect(report.results[0].violations[0]).toMatchObject({file: 'a.md', opinion: 'base.ascii-punctuation'});
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('a waived violation passes the gate and is reported with its approver', async () => {
    const root = installed();
    writeFileSync(join(root, 'a.md'), 'bad \u2014');
    const waiver = {opinion: 'base.ascii-punctuation', path: 'a.md', reason: 'quoted source', approved_by: 'the owner'};
    writeFileSync(join(root, '.forger', 'waivers.json'), JSON.stringify({waivers: [waiver]}));
    const report = JSON.parse(await capture(['check', '--json'], () => 'a.md'));
    expect(report.ok).toBe(true);
    expect(report.results[0].status).toBe('waived');
    expect(report.results[0].waived[0].waiver).toEqual(waiver);
    expect(process.exitCode).not.toBe(1);
  });

  test('a malformed waiver file is an error, not a waiver', async () => {
    const root = installed();
    writeFileSync(join(root, '.forger', 'waivers.json'), JSON.stringify({waivers: [{opinion: 'x.y', path: 'a.md'}]}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['check', '--json'], () => 'a.md');
    expect(err.mock.calls.join(' ')).toContain('reason');
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('without a lock there is nothing to run and it says so', async () => {
    process.chdir(projectWith({}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['check'], () => '');
    expect(err.mock.calls.join(' ')).toContain('forger.lock.json');
    err.mockRestore();
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
    const config = JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8'));
    expect(config.tracker.kind).toBe('local');
    const second = JSON.parse(await capture(['setup', '--json']));
    expect(second.files.map((f: {action: string}) => f.action)).not.toContain('written');
  });
});

describe('setup creates the loop labels', () => {
  test('creates the missing ones on a GitHub tracker, and none the second time', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-labels-')));
    dirs.push(root);
    process.chdir(root);
    const repo = new Set(['ready-for-agent']);
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('gh label list')) return [...repo].join('\n');
      const m = /^gh label create '([^']+)'/.exec(cmd);
      if (m) repo.add(m[1]);
      return '';
    };
    const first = JSON.parse(await capture(['setup', '--json'], run));
    expect(first.labels.created).toContain('needs-info');
    expect(first.labels.created).not.toContain('ready-for-agent');
    expect(JSON.parse(await capture(['setup', '--json'], run)).labels.created).toEqual([]);
  });
});

describe('skills --json', () => {
  test('resolves each slot from the config against the installed skills', async () => {
    const root = projectWith({});
    writeFileSync(
      join(root, '.forger', 'workloop.config.json'),
      JSON.stringify({tracker: {kind: 'local'}, skills: {review: 'c:review', diagnose: 'c:gone'}})
    );
    process.chdir(root);
    const out = JSON.parse(await capture(['skills', '--json'], undefined, () => ['c:review']));
    const by = Object.fromEntries(out.slots.map((s: {slot: string}) => [s.slot, s]));
    expect(by.review).toMatchObject({skill: 'c:review', installed: true, invoke: 'skill'});
    expect(by.diagnose).toMatchObject({skill: 'c:gone', installed: false, invoke: 'builtin'});
    expect(by.interview).toMatchObject({skill: null, invoke: 'builtin'});
  });
  test('a file slot is read from a collection root and reported with its path, forbid list and preamble', async () => {
    const root = projectWith({});
    const coll = mkdtempSync(join(tmpdir(), 'forger-coll-'));
    mkdirSync(join(coll, 'skills', 'r'), {recursive: true});
    writeFileSync(join(coll, 'skills', 'r', 'SKILL.md'), 'x');
    writeFileSync(
      join(root, '.forger', 'workloop.config.json'),
      JSON.stringify({tracker: {kind: 'local'}, skills: {review: {file: 'skills/r/SKILL.md'}, diagnose: {file: 'nope/SKILL.md'}}})
    );
    process.chdir(root);
    const out = JSON.parse(await capture(['skills', '--json'], undefined, () => ['tdd'], () => [coll]));
    const by = Object.fromEntries(out.slots.map((s: {slot: string}) => [s.slot, s]));
    expect(by.review).toMatchObject({invoke: 'file', installed: true, path: join(coll, 'skills', 'r', 'SKILL.md')});
    expect(by.diagnose).toMatchObject({invoke: 'builtin', installed: false});
    expect(out.forbid).toContain('mattpocock-skills:wayfinder');
    expect(out.preamble).toContain('Do not commit');
  });
  test('--presets lists the presets whose collection is installed', async () => {
    process.chdir(projectWith({}));
    const hit = JSON.parse(await capture(['skills', '--presets', '--json'], undefined, () => ['mattpocock-skills:tdd']));
    expect(hit.map((p: {name: string}) => p.name)).toEqual(['mattpocock-skills']);
    expect(JSON.parse(await capture(['skills', '--presets', '--json'], undefined, () => []))).toEqual([]);
  });
});

describe('packs --detect', () => {
  test('suggests the packs a repository calls for, with the facts', async () => {
    const root = projectWith({});
    writeFileSync(join(root, 'package.json'), JSON.stringify({dependencies: {react: '1'}}));
    process.chdir(root);
    const out = JSON.parse(await capture(['packs', '--detect', '--json']));
    expect(out.map((s: {id: string}) => [s.id])).toEqual([['ui']]);
    expect(out[0].reasons).toEqual(['dep:react']);
  });
  test('says so when nothing is suggested', async () => {
    process.chdir(projectWith({}));
    expect(await capture(['packs', '--detect'])).toContain('no packs suggested');
  });
});

describe('setup --preset', () => {
  test('writes the preset into the new config and offers it when installed', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
    dirs.push(root);
    mkdirSync(join(root, '.forger'));
    process.chdir(root);
    const out = JSON.parse(await capture(['setup', '--json', '--preset', 'mattpocock-skills'], undefined, () => ['mattpocock-skills:tdd']));
    expect(out.presets).toEqual(['mattpocock-skills']);
    const config = JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8'));
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

  test('facts reports the checkout and the issue without a network', async () => {
    process.chdir(projectWith({a: {status: 'not_started'}}));
    const run: CommandRunner = cmd =>
      cmd === 'git branch --show-current' ? 'main' : cmd.startsWith('gh issue view') ? '{"state":"OPEN","closedByPullRequestsReferences":[]}' : '';
    const out = JSON.parse(await capture(['facts', '--json', '--issue', '4'], run));
    expect(out.branch).toBe('main');
    expect(out.issue).toEqual({number: 4, state: 'OPEN', closing_pr: null});
  });

  test('merge refuses a PR with a failing check and exits 1, without merging', async () => {
    process.chdir(projectWith({a: {status: 'not_started'}}));
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      return cmd.startsWith('gh pr view 9')
        ? JSON.stringify({number: 9, state: 'OPEN', statusCheckRollup: [{__typename: 'CheckRun', name: 'gates', status: 'COMPLETED', conclusion: 'FAILURE'}]})
        : '';
    };
    try {
      const out = JSON.parse(await capture(['merge', '--pr', '9', '--json'], run));
      expect(out).toEqual({pr: 9, merged: false, checks: 'failure', failing_checks: ['gates'], reason: 'failing checks: gates'});
      expect(process.exitCode).toBe(1);
      expect(calls.some(c => c.startsWith('gh pr merge'))).toBe(false);
    } finally {
      process.exitCode = 0;
    }
  });

  test('orient surfaces a halt with the reason from the HALT file', async () => {
    const root = projectWith({a: {status: 'not_started'}});
    writeFileSync(join(root, '.forger', 'HALT'), 'cut off before merge');
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
      join(root, '.forger', 'events.jsonl'),
      '{"event":"completed","at":"2000-01-01T00:00:00.000Z","iteration":1,"ticket":null,"reason":null}\n'
    );
    process.chdir(root);
    const out = JSON.parse(await capture(['events', '--json']));
    expect(out.map((e: {event: string}) => e.event)).toEqual(['completed']);
  });
});

describe('measure and retro', () => {
  test('measure reads the logs, the work log and CI runs', async () => {
    const root = projectWith({});
    mkdirSync(join(root, '.forger/output'));
    writeFileSync(
      join(root, '.forger/output/iteration-1.log'),
      '=== forger iteration 1 ===\nticket: alpha_ticket\nelapsed: 90s\noutcome: exited with code 0\n=== output ===\nok\n'
    );
    writeFileSync(join(root, '.forger/work.log'), '[t] [INFO] Ticket: alpha_ticket [opus, $20]\n');
    process.chdir(root);
    const run: CommandRunner = () => JSON.stringify([{headBranch: 'feat/alpha-ticket', event: 'pull_request'}]);
    const out = JSON.parse(await capture(['measure', '--json'], run));
    expect(out.tickets).toEqual([{ticket: 'alpha_ticket', runs: 1, seconds: 90, budget_usd: 20, ci_rounds: 1}]);
  });

  test('measure --json carries merged tickets, rework and owner interventions', async () => {
    const root = projectWith({});
    process.chdir(root);
    const run: CommandRunner = () => '[]';
    const out = JSON.parse(await capture(['measure', '--json'], run));
    expect(out.merged).toEqual({tickets: 0});
    expect(out.rework).toEqual({redone_tickets: 0});
    expect(out.owner_interventions).toEqual({total: 0, by_event: {}});
  });

  test('measure --report prints the report and --diff the delta of two reports', async () => {
    const root = projectWith({});
    process.chdir(root);
    const run: CommandRunner = () => '[]';
    const report = JSON.parse(await capture(['measure', '--report'], run));
    expect(report.tickets_merged).toBe(0);
    writeFileSync(join(root, 'a.json'), JSON.stringify(report));
    writeFileSync(join(root, 'b.json'), JSON.stringify({...report, tickets_merged: 3}));
    const diff = JSON.parse(await capture(['measure', '--diff', 'a.json', 'b.json'], run));
    expect(diff.tickets_merged).toEqual({a: 0, b: 3, delta: 3});
  });

  test('measure survives gh failing', async () => {
    const root = projectWith({});
    process.chdir(root);
    const run: CommandRunner = () => {
      throw new Error('gh: not logged in');
    };
    expect(JSON.parse(await capture(['measure', '--json'], run)).runs.total).toBe(0);
  });

  test('retro rule writes the record into .forger/rules', async () => {
    const root = projectWith({});
    process.chdir(root);
    const out = await capture([
      'retro', 'rule', '--name', 'a-rule', '--description', 'd', '--type', 'feedback', '--rule', 'Do it.',
      '--owner', 'their words', '--date', '2026-11-03', '--why', 'because', '--how', 'always',
    ]);
    expect(out).toBe('.forger/rules/a-rule.md');
    expect(readFileSync(join(root, out), 'utf-8')).toContain('Owner (2026-11-03): "their words"');
  });

  test('retro rule refuses a bad name and writes nothing', async () => {
    const root = projectWith({});
    process.chdir(root);
    await capture(['retro', 'rule', '--name', '../x']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('retro upstream drafts an issue with the evidence', async () => {
    const root = projectWith({});
    process.chdir(root);
    const out = JSON.parse(await capture(['retro', 'upstream', '--title', 'T', '--lesson', 'L', '--evidence', 'e1', '--evidence', 'e2', '--json']));
    expect(out.body).toContain('- e1\n- e2');
  });
});

describe('packs and opinions', () => {
  test('before setup nothing is installed and no opinions are listed', async () => {
    process.chdir(projectWith({}));
    const packs = JSON.parse(await capture(['packs', '--json']));
    expect(packs.find((p: {id: string}) => p.id === 'base')).toMatchObject({installed: false, installedVersion: null});
    expect(JSON.parse(await capture(['opinions', '--json']))).toEqual([]);
  });

  test('after setup the base pack and its opinions are listed', async () => {
    const root = projectWith({});
    process.chdir(root);
    await capture(['setup', '--json']);
    const packs = JSON.parse(await capture(['packs', '--json']));
    expect(packs.find((p: {id: string}) => p.id === 'base').installed).toBe(true);
    const opinions = JSON.parse(await capture(['opinions', '--json']));
    expect(opinions.every((o: {pack: string}) => o.pack === 'base')).toBe(true);
    expect(opinions.find((o: {id: string}) => o.id === 'base.ascii-punctuation')).toMatchObject({rung: 'check', check: 'docs'});
    expect(opinions.find((o: {id: string}) => o.id === 'base.determinism-first').check).toBeNull();
  });

  test('setup with an unknown pack fails', async () => {
    process.chdir(projectWith({}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['setup', '--packs', 'nope']);
      expect(err).toHaveBeenCalledWith('Unknown pack: nope');
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      process.exitCode = 0;
    }
  });
});

describe('check ui', () => {
  const ui = JSON.stringify({paths: ['src/**/*.tsx'], start: 's'});
  const run = (status: string): CommandRunner => cmd => (cmd.startsWith('git merge-base') ? 'abc' : cmd.startsWith('git diff') ? status : '');

  test('fails a UI change with no screenshot; a screenshot in the diff passes', async () => {
    const root = projectWith({});
    process.chdir(root);
    writeFileSync(join(root, '.forger', 'ui.json'), ui);
    const bad = await capture(['check', 'ui', '--json'], run('M\tsrc/App.tsx'));
    expect(JSON.parse(bad).map((f: {opinion: string}) => f.opinion)).toEqual(['ui.evidence']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(await capture(['check', 'ui'], run('M\tsrc/App.tsx\nA\tdocs/screenshots/index-phone-light.png'))).toBe('ui check: clean');
  });
});

describe('screenshot', () => {
  test('without the ui config it fails as a config problem, not an infrastructure one', async () => {
    process.chdir(projectWith({}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['screenshot', '--json']);
      expect(JSON.parse(err.mock.calls[0][0])).toMatchObject({ok: false, infrastructure: false});
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      process.exitCode = 0;
    }
  });

  test('--wireframe without the page asks for it as a config problem', async () => {
    const root = projectWith({});
    process.chdir(root);
    writeFileSync(join(root, '.forger', 'ui.json'), JSON.stringify({paths: ['a'], start: 'x'}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['screenshot', '--json', '--wireframe', 'issue-9']);
      expect(JSON.parse(err.mock.calls[0][0])).toMatchObject({ok: false, infrastructure: false});
      expect(JSON.parse(err.mock.calls[0][0]).error).toContain('docs/design/issue-9/index.html not found');
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
      process.exitCode = 0;
    }
  });

  test('a project without Playwright exits 2 with the command that adds it', async () => {
    const root = projectWith({});
    process.chdir(root);
    const s = Bun.serve({port: 0, fetch: () => new Response('ok')});
    writeFileSync(join(root, '.forger', 'ui.json'), JSON.stringify({paths: ['a'], start: 'sleep 30', url: `http://127.0.0.1:${s.port}`, ready_timeout: 10}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['screenshot', '--json']);
      const out = JSON.parse(err.mock.calls[0][0]);
      expect(out).toMatchObject({ok: false, infrastructure: true});
      expect(out.error).toContain('playwright');
      expect(process.exitCode).toBe(2);
    } finally {
      err.mockRestore();
      s.stop(true);
      process.exitCode = 0;
    }
  });
});

describe('worktree and rebase', () => {
  test('worktree prints the path as JSON and never touches the main checkout', async () => {
    const root = projectWith({});
    process.chdir(root);
    const calls: string[] = [];
    const run: CommandRunner = cmd => (calls.push(cmd), '');
    const out = JSON.parse(await capture(['worktree', '--ticket', 'issue-5', '--json'], run));
    expect(out).toMatchObject({ok: true, branch: 'feat/issue-5', path: join(root, '.forger', 'worktrees', 'issue-5')});
    expect(calls.some(c => /checkout|switch|reset/.test(c))).toBe(false);
  });

  test('worktree --remove removes it', async () => {
    const root = projectWith({});
    process.chdir(root);
    const calls: string[] = [];
    await capture(['worktree', '--ticket', 'issue-5', '--remove', '--json'], cmd => (calls.push(cmd), ''));
    expect(calls[0]).toContain('git worktree remove --force');
  });

  test('an unusable ticket exits 1', async () => {
    const root = projectWith({});
    process.chdir(root);
    try {
      await capture(['worktree', '--ticket', '../x', '--json'], () => '');
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }
  });

  test('rebase reports clean as JSON', async () => {
    const root = projectWith({});
    process.chdir(root);
    const out = JSON.parse(await capture(['rebase', '--ticket', 'issue-5', '--json'], () => ''));
    expect(out).toMatchObject({status: 'clean', onto: 'origin/main'});
  });
});

describe('decline', () => {
  test('writes the record, relabels the issue through the runner and exits 0', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    process.chdir(root);
    const calls: string[] = [];
    const run: CommandRunner = cmd => (calls.push(cmd), cmd.startsWith('gh issue view') ? 'needs-info' : '');
    const out = JSON.parse(await capture(['decline', '--ticket', 'issue-5', '--reason', 'unclear', '--detail', 'which API?', '--json'], run));
    expect(out.declined).toMatchObject({ticket: 'issue-5', reason: 'unclear', detail: 'which API?'});
    expect(calls[0]).toContain('gh issue edit 5 --remove-label');
    expect(JSON.parse(readFileSync(join(root, '.forger', 'declined.json'), 'utf-8')).ticket).toBe('issue-5');
  });

  test('exits non-zero and names the label when the relabel did not hold', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    process.chdir(root);
    const run: CommandRunner = cmd => (cmd.startsWith('gh issue edit') ? (() => { throw new Error("'needs-info' not found"); })() : '');
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['decline', '--ticket', 'issue-5', '--reason', 'unclear', '--detail', 'x'], run);
      expect(process.exitCode).toBe(1);
      expect(err.mock.calls.flat().join(' ')).toContain("needs-info");
    } finally {
      process.exitCode = 0;
      err.mockRestore();
    }
    expect(existsSync(join(root, '.forger', 'declined.json'))).toBe(false);
  });

  test('rejects an unknown reason and an empty detail without touching the tracker', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    process.chdir(root);
    const calls: string[] = [];
    const run: CommandRunner = cmd => (calls.push(cmd), '');
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['decline', '--ticket', 'issue-5', '--reason', 'bored', '--detail', 'x'], run);
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await capture(['decline', '--ticket', 'issue-5', '--reason', 'blocked', '--detail', ' '], run);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      err.mockRestore();
    }
    expect(calls).toEqual([]);
  });

  test('a declined ticket leaves backlog next', async () => {
    const root = projectWith({a: {status: 'not_started', priority: 'P0'}, b: {status: 'not_started', priority: 'P1'}});
    process.chdir(root);
    expect(JSON.parse(await capture(['backlog', '--json'])).next).toBe('a');
    await capture(['decline', '--ticket', 'a', '--reason', 'too-large', '--detail', 'split it']);
    expect(JSON.parse(await capture(['backlog', '--json'])).next).toBe('b');
  });
});

describe('handover', () => {
  function seed(root: string, rounds: Array<'met' | 'not_met'>): void {
    const dir = join(root, '.forger', 'verdicts');
    mkdirSync(dir, {recursive: true});
    rounds.forEach((v, i) => {
      const record = {
        pr: 7, head: `h${i}`, ticket: 'issue-5', verifier: 'm', decision: v === 'met' ? 'pass' : 'block',
        entries: [{criterion: 'c1', verdict: v, evidence: []}], problems: [], at: `2026-01-0${i + 1}T00:00:00Z`,
      };
      writeFileSync(join(dir, `pr-7-h${i}.json`), JSON.stringify(record));
    });
  }

  test('says fix while rounds remain and touches nothing', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    process.chdir(root);
    seed(root, ['not_met']);
    const calls: string[] = [];
    const out = JSON.parse(await capture(['handover', '--pr', '7', '--json'], cmd => (calls.push(cmd), '')));
    expect(out).toMatchObject({move: 'fix', round: 2, handed_over: null});
    expect(calls).toEqual([]);
  });

  test('hands the issue over when rounds are spent, exits 1, and --list reports it', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    process.chdir(root);
    seed(root, ['not_met', 'not_met']);
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      if (cmd.includes('--json body')) return '## Acceptance\n- [ ] it works\n';
      return cmd.includes('--json labels') ? 'needs-human' : '';
    };
    try {
      const out = JSON.parse(await capture(['handover', '--pr', '7', '--json'], run));
      expect(out).toMatchObject({move: 'hand_over', rounds: 2});
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }
    expect(calls.some(c => c.includes('--add-label needs-human'))).toBe(true);
    expect(calls.find(c => c.includes('issue comment'))).toContain('it works');
    const list = JSON.parse(await capture(['handover', '--list', '--json']));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ticket: 'issue-5', pr: 7});
    expect(await capture(['handover', '--list'])).toContain('issue-5');
  });

  test('reports a failed label and requires --pr', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    process.chdir(root);
    seed(root, ['not_met', 'not_met']);
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['handover', '--pr', '7'], () => '');
      expect(process.exitCode).toBe(1);
      expect(err.mock.calls.flat().join(' ')).toContain('not labelled');
      process.exitCode = 0;
      await capture(['handover']);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      err.mockRestore();
    }
  });
});

describe('pr-body', () => {
  test('--fix adds the closing line a skill left out, and a missing section still fails', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    process.chdir(root);
    const file = join(root, 'body.md');
    writeFileSync(file, 'Summary\n');
    const ok = JSON.parse(await capture(['pr-body', '--file', file, '--issue', '9', '--fix', '--json']));
    expect(ok).toEqual({ok: true, problems: []});
    expect(readFileSync(file, 'utf-8')).toContain('Closes #9');
    const bad = JSON.parse(await capture(['pr-body', '--file', file, '--issue', '9', '--section', 'Design to review', '--json']));
    expect(bad.ok).toBe(false);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
