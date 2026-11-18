import {describe, expect, test} from 'bun:test';

import type {Tracker, TrackerWrite} from '../../ports';
import {changelogEntry, firstEntryVersion, withEntry} from './changelog';
import {runRelease, type ReleaseDeps} from './command';
import type {FilePort} from './files';
import {mergesFromLog} from './gather';
import {planRelease, type Change} from './plan';

const change = (pr: number, labels: string[], ticket: number | null = pr - 1): Change => ({pr, ticket, title: `t${pr}`, labels});

const SETTINGS = {files: [{path: 'a.json', key: 'version'}, {path: 'b.json', key: 'version'}], changelog: 'CHANGELOG.md'};

function memory(files: Record<string, string>): FilePort & {files: Record<string, string>} {
  return {files, read: p => files[p] ?? null, write: (p, t) => void (files[p] = t)};
}

interface World {
  versions?: [string, string];
  tag?: boolean;
  log?: string;
  labels?: Record<number, string[]>;
  open?: {number: number; title: string}[];
}

function deps(w: World = {}): {deps: ReleaseDeps; writes: TrackerWrite[]; fs: ReturnType<typeof memory>; commands: string[]} {
  const [va, vb] = w.versions ?? ['0.1.0', '0.1.0'];
  const fs = memory({'a.json': `{\n  "name": "a",\n  "version": "${va}"\n}\n`, 'b.json': `{"version": "${vb}"}`});
  const writes: TrackerWrite[] = [];
  const commands: string[] = [];
  const labels = w.labels ?? {};
  const log = w.log ?? '';
  const tracker = {
    queue: 'tracker',
    tickets: () => Object.entries(labels).map(([n, l]) => ({number: Number(n), title: '', labels: l, body: ''})),
    list: () => w.open ?? [],
    apply: (write: TrackerWrite) => {
      writes.push(write);
      return 'https://example.invalid/issues/9\n';
    },
  } as unknown as Tracker;
  const run = (cmd: string): string => {
    commands.push(cmd);
    if (cmd.startsWith('git tag -l')) return w.tag ? 'v0.1.0\n' : '';
    if (cmd.startsWith('git log -1')) return 'abc123\n';
    if (cmd.startsWith('git log --first-parent')) return log;
    if (cmd.startsWith('gh pr list --state merged')) return JSON.stringify([10, 11, 12].map(n => ({number: n, closingIssuesReferences: [{number: n - 1}]})));
    throw new Error(`unexpected command: ${cmd}`);
  };
  return {deps: {settings: SETTINGS, baseBranch: 'main', intakeLabel: 'ready-for-agent', run, tracker, fs}, writes, fs, commands};
}

const LOG = 'h1\tfeat: one (#10) (#11)\nh2\tfix: two (#12)\nh3\tno pull request number\n';

describe('the plan', () => {
  test('the bump is minor when a merged ticket is an enhancement and patch when all are bugs', () => {
    const minor = planRelease('0.1.0', [change(2, ['bug']), change(3, ['enhancement'])]);
    const patch = planRelease('0.1.0', [change(2, ['bug']), change(3, [])]);
    expect(minor.kind === 'plan' && [minor.plan.bump, minor.plan.next]).toEqual(['minor', '0.2.0']);
    expect(patch.kind === 'plan' && [patch.plan.bump, patch.plan.next]).toEqual(['patch', '0.1.1']);
  });

  test('a breaking change is a minor bump below 1.0.0 and a major bump from 1.0.0', () => {
    const below = planRelease('0.4.2', [change(2, ['breaking', 'enhancement'])]);
    const from = planRelease('1.4.2', [change(2, ['breaking'])]);
    expect(below.kind === 'plan' && below.plan.next).toBe('0.5.0');
    expect(from.kind === 'plan' && from.plan.next).toBe('2.0.0');
  });

  test('--bump replaces the computed bump', () => {
    const r = planRelease('0.1.0', [change(2, ['bug'])], 'major');
    expect(r.kind === 'plan' && r.plan.next).toBe('1.0.0');
  });

  test('with no change since the last version there is nothing to release', () => {
    expect(planRelease('0.1.0', [])).toEqual({kind: 'nothing', current: '0.1.0'});
    const {deps: d} = deps({tag: true, log: ''});
    const out = runRelease({mode: 'plan', json: false}, d);
    expect(out.exitCode).toBe(0);
    expect(out.out).toContain('nothing to release');
    expect(runRelease({mode: 'write', json: false, version: '0.1.1'}, d).exitCode).toBe(1);
  });
});

describe('the changes', () => {
  test('the changes are the tickets merged since the tag of the current version', () => {
    const w = deps({tag: true, log: LOG, labels: {10: ['enhancement'], 11: ['bug']}});
    const out = runRelease({mode: 'plan', json: true}, w.deps);
    const plan = JSON.parse(out.out);
    expect(plan.next).toBe('0.2.0');
    expect(plan.changes.map((c: Change) => [c.pr, c.ticket])).toEqual([[11, 10], [12, 11]]);
    expect(w.commands).toContain('git log --first-parent --reverse --format=%H%x09%s v0.1.0..origin/main');
  });

  test('with no tag the range starts at the commit that last changed the version', () => {
    const w = deps({log: LOG});
    runRelease({mode: 'plan', json: false}, w.deps);
    expect(w.commands).toContain('git log --first-parent --reverse --format=%H%x09%s abc123..origin/main');
  });

  test('a log line without a trailing pull request number is no merge', () => {
    expect(mergesFromLog(LOG)).toEqual([{pr: 11, title: 'feat: one'}, {pr: 12, title: 'fix: two'}]);
  });

  test('files that disagree on the version are an error that names them', () => {
    const out = runRelease({mode: 'plan', json: false}, deps({versions: ['0.1.0', '0.2.0'], tag: true}).deps);
    expect(out.exitCode).toBe(1);
    expect(out.err).toContain('a.json holds 0.1.0');
    expect(out.err).toContain('b.json holds 0.2.0');
  });
});

describe('write and check', () => {
  const world = {tag: true, log: LOG, labels: {10: ['enhancement'], 11: ['bug']}};

  test('release --write puts the version in every configured file and a changelog entry on top', () => {
    const w = deps(world);
    w.fs.files['CHANGELOG.md'] = '# Changelog\n\n## 0.1.0\n\n### Added\n\n- old\n';
    expect(runRelease({mode: 'write', json: false, version: '0.2.0'}, w.deps).exitCode).toBe(0);
    expect(w.fs.files['a.json']).toBe('{\n  "name": "a",\n  "version": "0.2.0"\n}\n');
    expect(w.fs.files['b.json']).toBe('{"version": "0.2.0"}');
    const log = w.fs.files['CHANGELOG.md'];
    expect(log.indexOf('## 0.2.0')).toBeLessThan(log.indexOf('## 0.1.0'));
    expect(log).toContain('### Added\n\n- #10 feat: one (PR #11)');
    expect(log).toContain('### Fixed\n\n- #11 fix: two (PR #12)');
  });

  test('release --check names the file that holds another version', () => {
    const w = deps(world);
    runRelease({mode: 'write', json: false, version: '0.2.0'}, w.deps);
    expect(runRelease({mode: 'check', json: false, version: '0.2.0'}, w.deps).exitCode).toBe(0);
    w.fs.files['b.json'] = '{"version": "0.1.0"}';
    const out = runRelease({mode: 'check', json: false, version: '0.2.0'}, w.deps);
    expect(out.exitCode).toBe(1);
    expect(out.err).toBe('b.json holds 0.1.0, not 0.2.0');
    const missing = runRelease({mode: 'check', json: false, version: '0.3.0'}, w.deps);
    expect(missing.err).toContain('CHANGELOG.md starts with 0.2.0, not 0.3.0');
  });

  test('a changelog is made when there is none, and an entry goes after the header when there are no entries', () => {
    const entry = changelogEntry('0.2.0', [change(3, ['enhancement'])]);
    expect(withEntry(null, entry).startsWith('# Changelog\n\n## 0.2.0')).toBe(true);
    expect(firstEntryVersion(withEntry('# Changelog\n', entry))).toBe('0.2.0');
  });
});

describe('filing', () => {
  const world = {tag: true, log: LOG, labels: {10: ['enhancement']}};

  test('release --file files one release ticket and none while one is open', () => {
    const w = deps(world);
    expect(runRelease({mode: 'file', json: false}, w.deps).out).toContain('https://example.invalid/issues/9');
    expect(w.writes).toHaveLength(1);
    const write = w.writes[0] as Extract<TrackerWrite, {kind: 'file'}>;
    expect(write.title).toBe('Release 0.2.0');
    expect(write.labels).toEqual(['ready-for-agent']);
    expect(write.body).toContain('release --check --version 0.2.0');
    expect(write.body).toContain('#10 feat: one (PR #11)');
    const open = deps({...world, open: [{number: 40, title: 'Release 0.2.0'}]});
    expect(runRelease({mode: 'file', json: false}, open.deps).out).toContain('#40');
    expect(open.writes).toHaveLength(0);
  });

  test('release with no files configured says so and exits 1', () => {
    for (const settings of [undefined, {files: [], changelog: 'CHANGELOG.md'}]) {
      const w = deps(world);
      const out = runRelease({mode: 'plan', json: false}, {...w.deps, settings});
      expect(out.exitCode).toBe(1);
      expect(out.err).toContain('not configured');
    }
  });
});

describe('notes', () => {
  const log = '# Changelog\n\n## 0.2.0\n\n### Added\n\n- b (#2)\n\n## 0.1.0\n\n### Fixed\n\n- a (#1)\n';
  const withLog = () => {
    const w = deps();
    w.fs.files['CHANGELOG.md'] = log;
    return w;
  };

  test('release --notes prints the changelog entry of the version and nothing of another', () => {
    const w = withLog();
    const out = runRelease({mode: 'notes', json: false, version: '0.2.0'}, w.deps);
    expect(out.exitCode).toBe(0);
    expect(out.out).toBe('### Added\n\n- b (#2)');
    expect(runRelease({mode: 'notes', json: false, version: '0.1.0'}, w.deps).out).toBe('### Fixed\n\n- a (#1)');
  });

  test('release --notes for a version with no entry exits 1', () => {
    const w = withLog();
    expect(runRelease({mode: 'notes', json: false, version: '0.3.0'}, w.deps).exitCode).toBe(1);
    expect(runRelease({mode: 'notes', json: false, version: '0.2'}, w.deps).exitCode).toBe(1);
    expect(runRelease({mode: 'notes', json: false, version: '0.1.0'}, deps().deps).exitCode).toBe(1);
  });
});
