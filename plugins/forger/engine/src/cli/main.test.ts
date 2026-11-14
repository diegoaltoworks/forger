import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {claudeHooks, execRunner, gitStateStore} from '../adapters';
import {renderHookPolicy} from '../hooks';
import {HOOK_COMMAND_LINE} from '../packs';
import {findProjectRoot, main} from './main';
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
    expect(out.runner).toEqual({pid: null, alive: false, spendLimit: 'harness'});
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
      held: [],
    });
  });

  test('an empty backlog reports nothing to do', async () => {
    process.chdir(projectWith({done: {status: 'completed'}}));
    const out = JSON.parse(await capture(['backlog', '--json']));
    expect(out).toEqual({workable: [], remaining: 0, next: null, anomalies: [], held: []});
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
      if (cmd.startsWith('gh api user')) return 'loop\n';
      if (cmd.startsWith('gh pr list')) return '[]';
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
      held: [],
    });
    expect(calls.filter(c => c.startsWith('gh api graphql'))).toHaveLength(1);
  });

  test('orient --json reports an open outside PR as an anomaly', async () => {
    process.chdir(projectWith({}, {kind: 'github', label: 'go'}));
    const issues = JSON.stringify([{data: {repository: {issues: {nodes: [{number: 5, state: 'OPEN', labels: {nodes: [{name: 'go'}]}, timelineItems: {nodes: []}}]}}}}]);
    const run: CommandRunner = cmd => {
      if (cmd.startsWith('gh api graphql')) return issues;
      if (cmd.startsWith('gh api user')) return 'loop\n';
      if (cmd.startsWith('gh pr list --state open')) return JSON.stringify([{number: 188, title: 'fix', author: {login: 'someone'}, closingIssuesReferences: [{number: 5}]}]);
      return '';
    };
    const out = JSON.parse(await capture(['orient', '--json'], run));
    expect(out.anomalies).toContainEqual(expect.stringContaining('PR #188 from someone'));
    expect(out.action).toBe('nothing_to_do');
    expect(out.blockers).toEqual(['issue-5 blocked by PR #188 (open, not the loop\'s)']);
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

describe('check docs README rule', () => {
  test('prints file, line, rule id and offending text, fails on a rule and only warns on passive voice', async () => {
    const root = projectWith({});
    writeFileSync(join(root, '.forger', 'forger.lock.json'), JSON.stringify({packs: [{id: 'docs', version: '1.0.0', files: []}]}));
    process.chdir(root);
    writeFileSync(join(root, 'README.md'), '# T\n\nThe file is checked by the tool.\n');
    const warn = spyOn(console, 'error').mockImplementation(() => {});
    const clean = await capture(['check', 'docs'], () => 'README.md');
    expect(clean).toBe('docs check: clean');
    expect(warn.mock.calls.join('\n')).toContain('README.md:3: readme-passive-voice: passive voice: "is checked"');
    expect(process.exitCode ?? 0).toBe(0);
    writeFileSync(join(root, 'README.md'), '# T\n\nIt has 12 files.\n');
    const bad = await capture(['check', 'docs'], () => 'README.md');
    warn.mockRestore();
    expect(bad).toBe('README.md:3: readme-transient: a count of things: "12 files"');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('check decisions', () => {
  test('fails on a layer map change with no ADR; an ADR in the diff passes', async () => {
    const root = projectWith({});
    writeFileSync(join(root, '.forger', 'architecture.json'), '{"layers":["b"]}');
    process.chdir(root);
    const run = (extra: string): CommandRunner => cmd =>
      cmd.startsWith('git merge-base') ? 'abc' : cmd.startsWith('git diff') ? `M\t.forger/architecture.json${extra}` : cmd.startsWith('git show') ? '{"layers":["a"]}' : '';
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

describe('check structure', () => {
  const tree = (root: string) => {
    writeFileSync(join(root, '.forger', 'structure.json'), '{"folder_limit": 1}');
    mkdirSync(join(root, 'src'));
    for (const f of ['a.ts', 'b.ts']) writeFileSync(join(root, 'src', f), 'export const x = 1;');
  };
  const lister = (list: string) => (cmd: string) => {
    if (cmd === 'git ls-files') return list;
    if (cmd.startsWith('git merge-base')) return 'abc';
    if (cmd.startsWith('git show')) throw new Error('not in the base');
    return '';
  };
  const files = lister('src/a.ts\nsrc/b.ts');

  test('prints findings and warnings as data, fails on a new finding and passes once recorded', async () => {
    const root = projectWith({});
    process.chdir(root);
    tree(root);
    const bad = JSON.parse(await capture(['check', 'structure', '--json'], files));
    expect(bad.findings.map((f: {rule: string; path: string}) => [f.rule, f.path])).toEqual([['structure.folder-size', 'src']]);
    expect(bad.warnings).toEqual([]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(JSON.parse(await capture(['check', 'structure', '--baseline', '--json'], files))).toEqual({baseline: 'written', entries: 1});
    const ok = JSON.parse(await capture(['check', 'structure', '--json'], files));
    expect(ok.findings).toEqual([]);
    expect(ok.warnings).toHaveLength(1);
    expect(process.exitCode).toBe(0);
    expect(await capture(['check', 'structure', '--update'], lister('src/a.ts'))).toBe('structure baseline: 1 entries removed');
    const text = await capture(['check', 'structure'], files);
    expect(text).toContain('structure.folder-size');
    process.exitCode = 0;
  });

  test('a missing config fails loudly', async () => {
    process.chdir(projectWith({}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['check', 'structure'], () => '');
    expect(err.mock.calls[0][0]).toContain('structure.json not found');
    err.mockRestore();
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

/** A repo whose files are all `a.md` and whose branch changes nothing against its merge-base. */
const cleanGit: CommandRunner = cmd => (cmd.startsWith('git merge-base') ? 'abc123' : /^git (diff|rev-parse)/.test(cmd) ? '' : 'a.md');

describe('check', () => {
  function installed(): string {
    const root = projectWith({});
    writeFileSync(join(root, '.forger', 'forger.lock.json'), JSON.stringify({packs: [{id: 'base', version: '1.1.0', files: []}]}));
    writeFileSync(join(root, '.forger', 'hooks.json'), renderHookPolicy());
    mkdirSync(join(root, '.claude'), {recursive: true});
    writeFileSync(join(root, '.claude', 'settings.json'), claudeHooks.install(null, 'bun /p/bin/work.ts hook'));
    writeFileSync(join(root, 'a.md'), 'clean');
    process.chdir(root);
    return root;
  }

  test('all clean: every check passed, exit 0', async () => {
    installed();
    const report = JSON.parse(await capture(['check', '--json'], cleanGit));
    expect(report).toEqual({
      ok: true,
      gaps: [],
      results: [
        {check: 'docs', opinions: ['base.ascii-punctuation', 'base.nothing-personal', 'base.no-hard-coded-skills', 'base.model-agnostic', 'base.merge-through-tool'], status: 'passed', violations: [], waived: [], gaps: []},
        {check: 'hooks', opinions: ['base.worker-hooks'], status: 'passed', violations: [], waived: [], gaps: []},
        {check: 'guards', opinions: ['base.guards-hold'], status: 'passed', violations: [], waived: [], gaps: []},
      ],
      waivers: [],
      staleWaivers: [],
    });
    expect(process.exitCode).not.toBe(1);
  });

  test('--summary prints the CI job summary in markdown', async () => {
    installed();
    const out = await capture(['check', '--summary'], cleanGit);
    expect(out).toContain('## forger check: passed');
    expect(out).toContain('| docs | `base.ascii-punctuation`, `base.nothing-personal`, `base.no-hard-coded-skills`, `base.model-agnostic`, `base.merge-through-tool` | passed | 0 | 0 |');
  });

  test('one violation: failed, carries the opinion id, exit 1', async () => {
    const root = installed();
    writeFileSync(join(root, 'a.md'), 'bad \u2014');
    const report = JSON.parse(await capture(['check', '--json'], cleanGit));
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
    const report = JSON.parse(await capture(['check', '--json'], cleanGit));
    expect(report.ok).toBe(true);
    expect(report.results[0].status).toBe('waived');
    expect(report.results[0].waived[0].waiver).toEqual(waiver);
    expect(process.exitCode).not.toBe(1);
  });

  test('a malformed waiver file is an error, not a waiver', async () => {
    const root = installed();
    writeFileSync(join(root, '.forger', 'waivers.json'), JSON.stringify({waivers: [{opinion: 'x.y', path: 'a.md'}]}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['check', '--json'], cleanGit);
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
    const first = JSON.parse(await capture(['setup', '--json', '--no-starter', '--gates', 'make test', '--tracker', 'local']));
    expect(first.files.map((f: {action: string}) => f.action)).not.toContain('kept');
    const config = JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8'));
    expect(config.tracker.kind).toBe('local');
    const second = JSON.parse(await capture(['setup', '--json', '--no-starter']));
    expect(second.files.map((f: {action: string}) => f.action)).not.toContain('written');
  });

  test('installs the hook policy and the hook into the harness settings, keeping the settings already there', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({permissions: {allow: ['Bash(ls)']}}));
    process.chdir(root);
    const first = JSON.parse(await capture(['setup', '--json', '--tracker', 'local']));
    expect(first.files).toContainEqual({path: '.claude/settings.json', action: 'written'});
    expect(first.files).toContainEqual({path: '.forger/hooks.json', action: 'written'});
    const settings = readFileSync(join(root, '.claude', 'settings.json'), 'utf-8');
    expect(JSON.parse(settings).permissions).toEqual({allow: ['Bash(ls)']});
    expect(JSON.parse(settings).hooks.PreToolUse[0].hooks[0].command).toBe(HOOK_COMMAND_LINE);
    expect(JSON.parse(readFileSync(join(root, '.forger', 'hooks.json'), 'utf-8')).rules).toEqual(['merge', 'push-base', 'status-write', 'state-edit', 'leave-worktree']);
    const second = JSON.parse(await capture(['setup', '--json']));
    expect(second.files).toContainEqual({path: '.claude/settings.json', action: 'kept'});
    expect(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8')).toBe(settings);
  });
});

describe('setup --sandbox', () => {
  test('setup --sandbox docker reports an unreachable Docker API and names the fix', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    const unreachable: CommandRunner = cmd => {
      if (cmd.startsWith('docker info')) throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');
      return '';
    };
    const out = JSON.parse(await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local', '--sandbox', 'docker'], unreachable));
    expect(out.sandbox.docker.reachable).toBe(false);
    expect(out.sandbox.docker.fix.join('\n')).toContain('rootless');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8')).sandbox).toBe('docker');
  });

  test('a reachable Docker API passes and an unknown sandbox is refused', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    const none = JSON.parse(await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local', '--sandbox', 'docker'], () => '27.0'));
    expect(none.sandbox.docker.image).toBe(false);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    mkdirSync(join(root, '.devcontainer'));
    writeFileSync(join(root, '.devcontainer', 'devcontainer.json'), '{"image": "mine:1"}');
    const out = JSON.parse(await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local', '--sandbox', 'docker'], () => '27.0'));
    expect(out.sandbox).toEqual({sandbox: 'docker', docker: {reachable: true, fix: [], image: true}});
    expect(process.exitCode ?? 0).toBe(0);
    await capture(['setup', '--json', '--sandbox', 'nope']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('setup with the testing pack', () => {
  test('carries the missing lcov report and the runner flag as next steps', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    writeFileSync(join(root, 'bunfig.toml'), '');
    const out = JSON.parse(await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local', '--packs', 'base,testing']));
    expect(out.coverage.report_present).toBe(false);
    expect(out.next_steps.join('\n')).toContain('coverage/lcov.info');
    expect(out.next_steps.join('\n')).toContain('bun test --coverage --coverage-reporter=lcov');
  });

  test('says nothing about coverage without the testing pack', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    const out = JSON.parse(await capture(['setup', '--json', '--no-starter', '--tracker', 'local']));
    expect(out.next_steps).toBeUndefined();
  });
});

describe('setup starter', () => {
  function empty(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-starter-')));
    dirs.push(root);
    process.chdir(root);
    return root;
  }

  test('an empty repository gets the default starter, its gates and its coverage advice', async () => {
    const root = empty();
    const out = JSON.parse(await capture(['setup', '--json', '--tracker', 'local']));
    expect(out.starter).toBe('bun-typescript');
    expect(existsSync(join(root, 'src', 'core', 'greet.ts'))).toBe(true);
    expect(out.coverage.gates_write_report).toBe(true);
  });

  test('--no-starter leaves an empty repository without a skeleton', async () => {
    const root = empty();
    const out = JSON.parse(await capture(['setup', '--json', '--no-starter', '--tracker', 'local']));
    expect(out.starter).toBeUndefined();
    expect(existsSync(join(root, 'package.json'))).toBe(false);
    expect(existsSync(join(root, 'src'))).toBe(false);
  });

  test('an unknown starter name is an error that lists the names', async () => {
    const root = empty();
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['setup', '--json', '--starter', 'nope', '--tracker', 'local']);
    expect(err.mock.calls.join(' ')).toContain('bun-typescript');
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(existsSync(join(root, '.forger'))).toBe(false);
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

describe('setup requires the forger/verify check', () => {
  function inRepo(): void {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-protect-')));
    dirs.push(root);
    process.chdir(root);
  }

  test('adds it to the base branch required checks on a GitHub tracker', async () => {
    inRepo();
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      return cmd.endsWith('/protection/required_status_checks') ? JSON.stringify({contexts: ['gates']}) : '';
    };
    const out = JSON.parse(await capture(['setup', '--json'], run));
    expect(out.verify_check).toEqual({required: true, added: true});
    expect(calls).toContain("gh api -X POST repos/{owner}/{repo}/branches/main/protection/required_status_checks/contexts -f 'contexts[]=forger/verify'");
  });

  test('reports it when the token cannot change the protection', async () => {
    inRepo();
    const run: CommandRunner = cmd => {
      if (cmd.includes('/protection')) throw new Error('gh: Must have admin rights to Repository. (HTTP 403)');
      return '';
    };
    const out = JSON.parse(await capture(['setup', '--json'], run));
    expect(out.verify_check).toMatchObject({required: false, added: false, error: expect.stringContaining('admin rights')});
  });

  test('a local tracker leaves the protection alone', async () => {
    inRepo();
    const calls: string[] = [];
    const out = JSON.parse(await capture(['setup', '--json', '--tracker', 'local'], cmd => (calls.push(cmd), '')));
    expect(out.verify_check).toBeUndefined();
    expect(calls.some(c => c.includes('/protection'))).toBe(false);
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
    expect(by.diagnose).toMatchObject({skill: 'c:gone', installed: false, invoke: 'file'});
    expect(by.interview).toMatchObject({skill: null, invoke: 'builtin'});
  });
  test('a file slot is read from a collection root and reported with its path, forbid list and preamble', async () => {
    const root = projectWith({});
    const coll = mkdtempSync(join(tmpdir(), 'forger-coll-'));
    dirs.push(coll);
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
    expect(by.diagnose).toMatchObject({invoke: 'file', installed: false});
    expect(out.forbid).toContain('mattpocock-skills:wayfinder');
    expect(out.preamble).toContain('Do not commit');
  });
  test('a flavour resolves against a bare install, without the plugin prefix', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
    dirs.push(root);
    mkdirSync(join(root, '.forger'));
    writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, flavour: 'agent-skills@1'}));
    process.chdir(root);
    const out = JSON.parse(await capture(['skills', '--json'], undefined, () => ['interview-me', 'test-driven-development', 'code-review-and-quality']));
    const by = Object.fromEntries(out.slots.map((s: {slot: string}) => [s.slot, s]));
    expect(by.interview).toMatchObject({invoke: 'skill', installed: true});
    expect(by.test_first).toMatchObject({invoke: 'skill', installed: true});
    expect(by.review).toMatchObject({invoke: 'skill', installed: true});
    expect(by.diagnose).toMatchObject({skill: null, installed: false});
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
  test('in a repository that is not set up yet, reads that repository and not a parent holding .claude', async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'forger-root-parent-')));
    dirs.push(parent);
    const repo = join(parent, 'repo');
    mkdirSync(repo);
    mkdirSync(join(parent, '.claude'));
    // The bait: the parent's react dependency would suggest the ui pack if the detection climbed there.
    writeFileSync(join(parent, 'package.json'), JSON.stringify({dependencies: {react: '1'}}));
    execRunner(repo)('git init -q');
    process.chdir(repo);
    expect(findProjectRoot()).toBe(repo);
    expect(JSON.parse(await capture(['packs', '--detect', '--json']))).toEqual([]);
  });
  test('a repository whose .claude holds no forger config is still the root', async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'forger-root-harness-')));
    dirs.push(repo);
    mkdirSync(join(repo, '.claude'));
    execRunner(repo)('git init -q');
    process.chdir(repo);
    expect(findProjectRoot()).toBe(repo);
  });
});

describe('setup --flavour', () => {
  test('writes the flavour into the new config and offers it when installed', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
    dirs.push(root);
    mkdirSync(join(root, '.forger'));
    process.chdir(root);
    const out = JSON.parse(await capture(['setup', '--json', '--preset', 'mattpocock-skills'], undefined, () => ['mattpocock-skills:tdd']));
    expect(out.presets).toEqual(['mattpocock-skills']);
    const config = JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8'));
    expect(config.flavour).toBe('mattpocock-skills@2');
    expect(config.skills).toEqual({});
  });
  test('--flavour is the same as --preset', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
    dirs.push(root);
    mkdirSync(join(root, '.forger'));
    process.chdir(root);
    await capture(['setup', '--json', '--flavour', 'mattpocock-skills'], undefined, () => []);
    expect(JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8')).flavour).toBe('mattpocock-skills@2');
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

describe('hooks gate before a worker starts', () => {
  /** A repository set up before the hooks gate existed: the base pack is locked, but there is no hook policy and no harness hook. */
  function olderInstall(): string {
    const root = projectWith({a: {status: 'not_started', priority: 'P0'}});
    writeFileSync(join(root, '.forger', 'forger.lock.json'), JSON.stringify({packs: [{id: 'base', version: '1.1.0', files: []}]}));
    return root;
  }

  test('run refuses to start a worker when the hooks gate fails and names setup', async () => {
    process.chdir(olderInstall());
    const err: string[] = [];
    const orig = console.error;
    console.error = (m: string) => void err.push(String(m));
    try {
      await capture(['run'], () => 'main');
      expect(process.exitCode).toBe(1);
    } finally {
      console.error = orig;
      process.exitCode = 0;
    }
    expect(err.join('\n')).toContain('Not starting: the hooks gate fails');
    expect(err.join('\n')).toContain('work.ts setup');
  });

  test('orient reports a failing hooks gate as an anomaly', async () => {
    process.chdir(olderInstall());
    const out = JSON.parse(await capture(['orient', '--json'], cmd => (cmd.startsWith('git status') ? '' : 'main')));
    expect(out.anomalies.join(' ')).toContain('run `work.ts setup`');
  });

  test('setup on an older install keeps the config and adds the hook policy and harness hook', async () => {
    const root = olderInstall();
    const config = readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8');
    process.chdir(root);
    const out = JSON.parse(await capture(['setup', '--json', '--tracker', 'local']));
    expect(out.files).toContainEqual({path: '.forger/workloop.config.json', action: 'kept'});
    expect(out.files).toContainEqual({path: '.forger/hooks.json', action: 'written'});
    expect(out.files).toContainEqual({path: '.claude/settings.json', action: 'written'});
    expect(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8')).toBe(config);
    const after = JSON.parse(await capture(['orient', '--json'], () => 'main'));
    expect(after.anomalies.join(' ')).not.toContain('hooks gate');
  });

  test('setup writes a hook command with no absolute home path', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    await capture(['setup', '--json', '--tracker', 'local']);
    const command = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8')).hooks.PreToolUse[0].hooks[0].command as string;
    expect(command).toBe(HOOK_COMMAND_LINE);
    expect(command).not.toMatch(/\/(home|Users)\//);
  });
});

describe('supervisor commands', () => {
  test('orient lists a behind base branch as an anomaly', async () => {
    process.chdir(projectWith({a: {status: 'not_started', priority: 'P0'}}));
    const run: CommandRunner = cmd => (cmd.startsWith('git rev-list') ? '2' : 'main');
    const out = JSON.parse(await capture(['orient', '--json'], run));
    expect(out.anomalies.join(' ')).toContain('2 commit(s) behind origin/main');
  });
  test('orient starts a runner when work remains and none is alive', async () => {
    process.chdir(projectWith({a: {status: 'not_started', priority: 'P0'}}));
    const out = JSON.parse(await capture(['orient', '--json'], cmd => (cmd.startsWith('git status') ? '' : 'main')));
    expect(out.action).toBe('start');
    expect(out.anomalies).toEqual([]);
  });

  test('facts reports the checkout and the issue without a network', async () => {
    process.chdir(projectWith({a: {status: 'not_started'}}));
    const run: CommandRunner = cmd =>
      cmd === 'git branch --show-current' ? 'main' : cmd.startsWith('gh issue view') ? '{"state":"OPEN","closedByPullRequestsReferences":[]}' : '';
    const out = JSON.parse(await capture(['facts', '--json', '--issue', '4'], run));
    expect(out.branch).toBe('main');
    expect(out.issue).toEqual({number: 4, state: 'OPEN', closing_pr: null, delivery: null});
  });

  test('facts --guards prints the guard files and the tests that name a path, with --json as data', async () => {
    const root = projectWith({a: {status: 'not_started'}});
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, '.forger/testing.json'), JSON.stringify({coverage_baseline: '.forger/cov.json'}));
    writeFileSync(join(root, 'src/layout.spec.ts'), "expect(x).toBe('src/app.ts')");
    process.chdir(root);
    const run: CommandRunner = cmd => (cmd === 'git ls-files' ? '.forger/cov.json\nsrc/layout.spec.ts\nsrc/app.ts\n' : '');
    const out = JSON.parse(await capture(['facts', '--json', '--guards', 'src/app.ts'], run));
    expect(out).toEqual({paths: ['src/app.ts'], guards: ['.forger/cov.json'], tests: ['src/layout.spec.ts'], journeys: []});
    expect(await capture(['facts', '--guards', 'src/app.ts'], run)).toContain('src/layout.spec.ts');
  });

  test('facts --product reports present false when there is no brief', async () => {
    process.chdir(projectWith({a: {status: 'not_started'}}));
    expect(JSON.parse(await capture(['facts', '--product', '--json']))).toEqual({present: false});
  });

  test('facts --product prints the parsed brief and what is missing', async () => {
    const root = projectWith({a: {status: 'not_started'}});
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs/product.md'), '## Who it is for\n\nCooks.\n\n## What they must be able to do\n\n- Plan a meal\n');
    process.chdir(root);
    const out = JSON.parse(await capture(['facts', '--product', '--json']));
    expect(out.present).toBe(true);
    expect(out.who).toBe('Cooks.');
    expect(out.journeys).toEqual(['Plan a meal']);
    expect(out.problems).toEqual(['missing section "## How success shows"', 'missing section "## Out"']);
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

  describe('resume', () => {
    const eventsOf = (root: string) => readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const halted = () => {
      const root = projectWith({a: {status: 'not_started'}});
      writeFileSync(join(root, '.forger', 'HALT'), 'boom');
      process.chdir(root);
      return root;
    };
    async function resume(argv: string[], run?: CommandRunner): Promise<void> {
      const err = spyOn(console, 'error').mockImplementation(() => {});
      try {
        await capture(['resume', ...argv], run);
      } finally {
        err.mockRestore();
      }
    }

    test('resume without a cause or a not-a-defect reason exits non-zero and leaves the halt', async () => {
      const root = halted();
      try {
        await resume([]);
        expect(process.exitCode).toBe(1);
        expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
        expect(existsSync(join(root, '.forger', 'events.jsonl'))).toBe(false);
      } finally {
        process.exitCode = 0;
      }
    });

    test('resume with a cause records the issue in halt_cleared', async () => {
      const root = halted();
      await resume(['--cause', '12']);
      expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
      expect(eventsOf(root)).toEqual([expect.objectContaining({event: 'halt_cleared', cause: 12, not_a_defect: null})]);
    });

    test('resume with a cause that is not an issue in the tracker is refused', async () => {
      const root = projectWith({a: {status: 'not_started'}}, {kind: 'github'});
      writeFileSync(join(root, '.forger', 'HALT'), 'boom');
      process.chdir(root);
      try {
        await resume(['--cause', '999'], cmd => {
          if (cmd.startsWith('gh issue view 999')) throw new Error('not found');
          return '';
        });
        expect(process.exitCode).toBe(1);
        expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
      } finally {
        process.exitCode = 0;
      }
    });

    test('resume with a not-a-defect reason records the reason in halt_cleared', async () => {
      const root = halted();
      await resume(['--not-a-defect', 'transient outage']);
      expect(eventsOf(root)).toEqual([expect.objectContaining({event: 'halt_cleared', cause: null, not_a_defect: 'transient outage'})]);
    });
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

  test('approval inside a project records the ask, and events still lists terminal events only', async () => {
    const root = projectWith({});
    process.chdir(root);
    expect(await capture(['approval', 'clear_halt'])).toBe('owner');
    const lines = readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toEqual([expect.objectContaining({event: 'approval_asked', reason: 'clear_halt: owner'})]);
    expect(JSON.parse(await capture(['events', '--json']))).toEqual([]);
  });

  test('events lists a recovered event, and recover reports no halt when none stands', async () => {
    const root = projectWith({});
    process.chdir(root);
    writeFileSync(join(root, '.forger', 'events.jsonl'), JSON.stringify({event: 'recovered', at: 'T', iteration: 1, ticket: 'a', reason: 'PR #2 verified after the merge: pass'}) + '\n');
    expect(JSON.parse(await capture(['events', '--json']))).toEqual([expect.objectContaining({event: 'recovered'})]);
    expect(await capture(['recover'])).toContain('no halt is standing');
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
    expect(out.tickets).toEqual([{ticket: 'alpha_ticket', runs: 1, seconds: 90, budget_cap_usd: 20, cost_usd: null, ci_rounds: 1}]);
  });

  test('measure --opinions with no records file exits 0 and says nothing is recorded', async () => {
    const root = projectWith({});
    process.chdir(root);
    process.exitCode = 0;
    const out = await capture(['measure', '--opinions'], () => '[]');
    expect(out).toContain('nothing is recorded yet');
    expect(Number(process.exitCode ?? 0)).toBe(0);
  });

  test('measure --opinions prints the failures of each opinion with a check, as JSON', async () => {
    const root = projectWith({});
    writeFileSync(join(root, '.forger/checks.jsonl'), JSON.stringify({at: 't', ticket: 'issue-1', iteration: 1, opinion: 'x.y', check: 'docs', failed: 1, waived: 0}) + '\n');
    process.chdir(root);
    const out = JSON.parse(await capture(['measure', '--opinions', '--json'], () => '[]'));
    expect(out.recorded).toBe(true);
    expect(out.opinions).toEqual([]);
  });

  const demoteRun: CommandRunner = cmd => (cmd.includes('gh pr list') ? JSON.stringify([{closingIssuesReferences: [{number: 1}, {number: 2}]}]) : '[]');

  function demoteProject(): void {
    const root = projectWith({});
    mkdirSync(join(root, '.forger'), {recursive: true});
    writeFileSync(join(root, '.forger/forger.lock.json'), JSON.stringify({packs: [{id: 'safety', version: '1', files: []}]}));
    writeFileSync(join(root, '.forger/checks.jsonl'), JSON.stringify({at: 't', ticket: 'issue-9', iteration: 1, opinion: 'safety.secrets', check: 'safety', failed: 1, waived: 0}) + '\n');
    process.chdir(root);
  }

  test('retro demote --list and --opinion name a check that never failed over enough merged tickets', async () => {
    demoteProject();
    const run = demoteRun;
    const list = JSON.parse(await capture(['retro', 'demote', '--list', '--json', '--min-merged', '2'], run));
    expect(list.candidates.map((c: {opinion: string}) => c.opinion)).toContain('safety.data-forward');
    expect(list.candidates.map((c: {opinion: string}) => c.opinion)).not.toContain('safety.secrets');
    const draft = JSON.parse(await capture(['retro', 'demote', '--opinion', 'safety.data-forward', '--json', '--min-merged', '2'], run));
    expect(draft.body).toContain('safety.data-forward');
  });

  test('retro demote refuses an opinion that is not a candidate and prints its numbers', async () => {
    demoteProject();
    const run = demoteRun;
    process.exitCode = 0;
    const errors: string[] = [];
    const orig = console.error;
    console.error = (m: string) => errors.push(m);
    await capture(['retro', 'demote', '--opinion', 'safety.secrets', '--min-merged', '2'], run);
    console.error = orig;
    expect(errors.join('')).toContain('safety.secrets (rung check): failed on 1 ticket(s)');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('measure --json carries the session cost beside the cap, unknown without a transcript', async () => {
    const root = projectWith({});
    mkdirSync(join(root, '.forger/output'));
    writeFileSync(join(root, '.forger/output/iteration-1.log'), '=== forger iteration 1 ===\nticket: issue-1\nelapsed: 9s\noutcome: exited with code 0\n=== output ===\nok\n');
    writeFileSync(join(root, '.forger/output/iteration-2.log'), '=== forger iteration 2 ===\nticket: issue-2\nelapsed: 9s\noutcome: exited with code 0\n=== output ===\nok\n');
    const [known, missing] = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
    writeFileSync(join(root, '.forger/work.log'), `[t] [INFO] Ticket: issue-1 [opus, $20] session ${known}\n[t] [INFO] Ticket: issue-2 [opus, $20] session ${missing}\n`);
    writeFileSync(join(root, '.forger/prices.json'), JSON.stringify({opus: {input: 2, output: 0, cache_read: 0, cache_write: 0}}));
    const config = join(root, 'harness');
    mkdirSync(join(config, 'projects/p'), {recursive: true});
    writeFileSync(join(config, 'projects/p', `${known}.jsonl`), JSON.stringify({message: {id: 'm', model: 'claude-opus-x', usage: {input_tokens: 1_000_000, output_tokens: 5}}}) + '\n');
    process.chdir(root);
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      const out = JSON.parse(await capture(['measure', '--json'], () => '[]'));
      expect(out.tickets.map((t: {ticket: string; budget_cap_usd: number; cost_usd: number | null}) => [t.ticket, t.budget_cap_usd, t.cost_usd])).toEqual([
        ['issue-1', 20, 2],
        ['issue-2', 20, null],
      ]);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
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
    expect(opinions.some((o: {pack: string}) => o.pack === 'base')).toBe(true);
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

  test('--capture of an undeclared name asks for it as a config problem', async () => {
    const root = projectWith({});
    process.chdir(root);
    writeFileSync(join(root, '.forger', 'ui.json'), JSON.stringify({paths: ['a'], start: 'x'}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await capture(['screenshot', '--json', '--capture', 'play']);
      expect(JSON.parse(err.mock.calls[0][0])).toMatchObject({ok: false, infrastructure: false});
      expect(JSON.parse(err.mock.calls[0][0]).error).toContain('no capture named "play"');
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
    expect(calls.filter(c => !c.startsWith('git rev-parse'))).toEqual([]);
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

  test('run from a worker worktree, it reads the verdicts of the main checkout', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    seed(root, ['not_met', 'not_met']);
    const worktree = join(root, '.forger', 'worktrees', 'issue-5');
    mkdirSync(join(worktree, '.forger'), {recursive: true});
    writeFileSync(join(worktree, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'github', label: 'ready-for-agent'}}));
    process.chdir(worktree);
    const run: CommandRunner = cmd => (cmd === 'git rev-parse --path-format=absolute --git-common-dir' ? join(root, '.git') : '');
    const list = JSON.parse(await capture(['handover', '--list', '--json'], run));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ticket: 'issue-5', pr: 7});
    expect(existsSync(join(worktree, '.forger', 'verdicts'))).toBe(false);
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

describe('reading state from the state branch', () => {
  /** A project whose clone has no state file, beside a remote whose state branch holds one. */
  function cloneWithRemoteState(): string {
    const root = projectWith({a: {status: 'not_started', priority: 'P0'}});
    const remote = realpathSync(mkdtempSync(join(tmpdir(), 'forger-remote-')));
    dirs.push(remote);
    const sh = (cwd: string, cmd: string) => execRunner(cwd)(cmd);
    sh(remote, 'git init --bare -q');
    sh(root, `git init -q && git remote add origin ${remote} && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`);
    const store = gitStateStore({repo: root});
    store.writeState(JSON.stringify({iteration: 7, completed_iterations: 3, status: 'running'}));
    store.appendEvent(JSON.stringify({event: 'completed', iteration: 7, ticket: 'a', at: '2026-01-01T00:00:00.000Z'}), new Date('2026-01-01T00:00:00Z'));
    return root;
  }

  test('status --json from a clone reads the state branch', async () => {
    process.chdir(cloneWithRemoteState());
    const out = JSON.parse(await capture(['status', '--json', '--from', 'branch']));
    expect(out.iteration).toBe(7);
    expect(out.counters.completed).toBe(3);
  });

  test('local home behaves as before: the same clone reads no state without --from', async () => {
    process.chdir(cloneWithRemoteState());
    const out = JSON.parse(await capture(['status', '--json']));
    expect(out.iteration).toBe(0);
  });

  test('measure reports iteration logs and transcripts as not on this machine, not as an error', async () => {
    process.chdir(cloneWithRemoteState());
    const out = JSON.parse(await capture(['measure', '--json', '--from', 'branch']));
    expect(out.not_on_this_machine).toContain('iteration logs');
    expect(out.events.completed).toBe(1);
  });

  test('--from rejects an unknown home', async () => {
    process.chdir(cloneWithRemoteState());
    await expect(capture(['status', '--json', '--from', 'cloud'])).rejects.toThrow('--from must be local or branch');
  });
});

describe('findProjectRoot', () => {
  test('a repository without .forger is the root even under a directory holding .claude', () => {
    const outer = realpathSync(mkdtempSync(join(tmpdir(), 'forger-root-')));
    dirs.push(outer);
    mkdirSync(join(outer, '.claude'));
    mkdirSync(join(outer, 'repo', 'src'), {recursive: true});
    Bun.spawnSync(['git', 'init', '-q'], {cwd: join(outer, 'repo')});
    expect(findProjectRoot(join(outer, 'repo', 'src'), outer)).toBe(join(outer, 'repo'));
  });
});

describe('critique', () => {
  test('a change that is not visual is skipped, naming why', async () => {
    process.chdir(projectWith({}));
    const run: CommandRunner = cmd => (cmd.startsWith('gh pr diff') ? 'src/engine.ts' : '');
    const out = JSON.parse(await capture(['critique', '--pr', '5', '--json'], run));
    expect(out).toMatchObject({status: 'skipped', pr: 5});
    expect(process.exitCode ?? 0).toBe(0);
  });

  test('needs a PR number and a known threshold', async () => {
    process.chdir(projectWith({}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['critique', '--pr', '5', '--threshold', 'urgent']);
    expect(err.mock.calls.join('\n')).toContain('Usage: critique --pr N');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    err.mockRestore();
  });
  test('a visual change is critiqued and its findings above the threshold are filed with the tracker label', async () => {
    const root = projectWith({}, {kind: 'github', label: 'ready-for-agent'});
    writeFileSync(join(root, '.forger', 'ui.json'), JSON.stringify({paths: ['src/ui/**'], start: 'bun dev'}));
    process.chdir(root);
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      if (cmd.startsWith('gh pr diff')) return 'src/ui/App.tsx';
      if (cmd.startsWith('gh pr view')) return JSON.stringify({headRefOid: 'abc1234'});
      if (cmd.startsWith('git worktree add')) {
        const dir = /--detach '([^']+)'/.exec(cmd)?.[1] as string;
        mkdirSync(join(dir, 'docs/screenshots'), {recursive: true});
        writeFileSync(join(dir, 'docs/plan-a.md'), '## Brief, verbatim\n\nA playful demo.\n');
        writeFileSync(join(dir, 'docs/screenshots/home.png'), 'x');
        return '';
      }
      if (cmd.includes("ls-files 'docs/plan*.md'")) return 'docs/plan-a.md';
      if (cmd.includes("ls-files 'docs/screenshots/'")) return 'docs/screenshots/home.png';
      if (cmd.startsWith('gh issue create')) return 'https://example.test/issues/9\n';
      return '';
    };
    const dims = ['feel', 'readability', 'feedback', 'fidelity'].map(name => ({name, score: 2, reason: 'flat'}));
    const agent = {
      async run(o: {prompt: string}) {
        const path = /write your result to (\S+) as JSON/.exec(o.prompt)?.[1] as string;
        writeFileSync(path, JSON.stringify({dimensions: dims, findings: [{severity: 'high', dimension: 'feel', title: "Make the hero's step audible", body: 'Add a sound.', evidence: 'docs/screenshots/home.png'}]}));
        return {exitCode: 0, signal: null, output: '', timedOut: false};
      },
    };
    const lines: string[] = [];
    const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')));
    try {
      await main(['critique', '--pr', '5'], {run, agent});
    } finally {
      spy.mockRestore();
    }
    const create = calls.find(c => c.startsWith('gh issue create')) as string;
    expect(create).toContain("--label 'ready-for-agent'");
    expect(create).toContain("Make the hero'\\''s step audible");
    expect(lines.join('\n')).toContain('filed https://example.test/issues/9 (high, feel)');
  });

  test('a failure reading the PR is reported and fails the command', async () => {
    process.chdir(projectWith({}));
    const err = spyOn(console, 'error').mockImplementation(() => {});
    await capture(['critique', '--pr', '5'], () => {
      throw new Error('gh is down');
    });
    expect(err.mock.calls.join('\n')).toContain('critique: gh is down');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    err.mockRestore();
  });
});

describe('setup --credential', () => {
  test('records the kind per harness and says how to make a subscription token', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    const out = JSON.parse(await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local', '--credential', 'subscription']));
    expect(out.credential).toMatchObject({harness: 'claude', kind: 'subscription', variables: ['CLAUDE_CODE_OAUTH_TOKEN']});
    expect(out.credential.howTo).toContain('setup-token');
    expect(JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8')).credentials.model).toEqual({claude: 'subscription'});
  });

  test('refuses a kind the harness has no variable for', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local', '--harness', 'codex', '--credential', 'subscription']);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
