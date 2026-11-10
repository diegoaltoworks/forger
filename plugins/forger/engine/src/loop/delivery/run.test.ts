import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandResult} from '../../ports';
import type {EventKind} from '../events';
import {DELIVERY_FAILED_TITLE} from './outcome';
import {runDelivery, type DeliveryDeps} from './run';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

interface Scene {
  config?: object | null;
  /** Exit code per command; absent means 0. */
  exits?: Record<string, number>;
  openIssue?: string;
  mergeFails?: boolean;
}

function scene(s: Scene = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forger-delivery-'));
  dirs.push(root);
  if (s.config !== null) {
    mkdirSync(join(root, '.forger'), {recursive: true});
    writeFileSync(join(root, '.forger', 'deliver.json'), JSON.stringify(s.config ?? {deploy: 'ship', check: 'smoke', rollback: 'revert'}));
  }
  const events: {kind: EventKind; reason: string | null}[] = [];
  const tracker: string[] = [];
  const probed: string[] = [];
  const halts: string[] = [];
  const warns: string[] = [];
  const deps: DeliveryDeps = {
    projectRoot: root,
    base: 'main',
    intakeLabel: 'ready-for-agent',
    run: cmd => {
      tracker.push(cmd);
      if (s.mergeFails && cmd.startsWith('git merge')) throw new Error('not a fast-forward');
      if (cmd.startsWith('gh pr list')) return '12\n';
      if (cmd.startsWith('gh issue list')) return s.openIssue ?? '';
      return '';
    },
    probe: (command): CommandResult => {
      probed.push(command);
      const exitCode = s.exits?.[command] ?? 0;
      return {stdout: exitCode === 0 ? '' : 'boom: the page is down', stderr: '', exitCode};
    },
    iteration: 4,
    ticket: 'issue-9',
    emit: (kind, _it, _t, reason) => events.push({kind, reason}),
    halt: reason => halts.push(reason),
    warn: m => warns.push(m),
  };
  return {deps, events, tracker, probed, halts, warns};
}

const created = (tracker: string[]) => tracker.filter(c => c.startsWith('gh issue create'));

describe('runDelivery', () => {
  test('a merge with the delivery pack installed runs deploy then check and records delivered', () => {
    const s = scene();
    runDelivery(s.deps);
    expect(s.probed).toEqual(['ship', 'smoke']);
    expect(s.tracker).toContain('git merge --ff-only origin/main');
    expect(s.events).toEqual([{kind: 'delivered', reason: 'PR #12: deployed and checked'}]);
  });

  test('a failed check files one P0 issue that links the merged PR', () => {
    const s = scene({exits: {smoke: 1}});
    runDelivery(s.deps);
    const [create] = created(s.tracker);
    expect(created(s.tracker)).toHaveLength(1);
    expect(create).toContain('--label P0');
    expect(create).toContain("--label 'ready-for-agent'");
    expect(create).toContain('#12');
    expect(create).toContain('boom: the page is down');
    expect(s.events.map(e => e.kind)[0]).toBe('delivery_failed');
  });

  test('a second failed delivery comments on the open issue and files nothing', () => {
    const s = scene({exits: {smoke: 1}, openIssue: '77'});
    runDelivery(s.deps);
    expect(created(s.tracker)).toEqual([]);
    expect(s.tracker.some(c => c.startsWith('gh issue comment 77 --body'))).toBe(true);
    expect(s.tracker.find(c => c.startsWith('gh issue list'))).toContain(DELIVERY_FAILED_TITLE);
  });

  test('a failed check runs the rollback when one is configured and records rolled_back', () => {
    const s = scene({exits: {smoke: 1}});
    runDelivery(s.deps);
    expect(s.probed).toEqual(['ship', 'smoke', 'revert']);
    expect(s.events.map(e => e.kind)).toEqual(['delivery_failed', 'rolled_back']);
    expect(s.halts).toEqual([]);
  });

  test('a failed deploy skips the check and rolls back', () => {
    const s = scene({exits: {ship: 2}});
    runDelivery(s.deps);
    expect(s.probed).toEqual(['ship', 'revert']);
  });

  test('a failed rollback halts the loop', () => {
    const s = scene({exits: {smoke: 1, revert: 1}});
    runDelivery(s.deps);
    expect(s.events.map(e => e.kind)).toEqual(['delivery_failed', 'rollback_failed']);
    expect(s.halts).toHaveLength(1);
    expect(s.halts[0]).toContain('no way back');
  });

  test('a failed delivery with no rollback does not halt', () => {
    const s = scene({config: {check: 'smoke'}, exits: {smoke: 1}});
    runDelivery(s.deps);
    expect(s.probed).toEqual(['smoke']);
    expect(s.events.map(e => e.kind)).toEqual(['delivery_failed']);
    expect(s.halts).toEqual([]);
    expect(created(s.tracker)).toHaveLength(1);
  });

  test('a command past its limit is reported as a timeout', () => {
    const s = scene({exits: {smoke: 124}});
    runDelivery(s.deps);
    expect(s.events[0].reason).toContain('ran past its');
  });

  test('without the delivery pack a merge runs no command and records no delivery event', () => {
    const s = scene({config: null});
    runDelivery(s.deps);
    expect(s.probed).toEqual([]);
    expect(s.tracker).toEqual([]);
    expect(s.events).toEqual([]);
  });

  test('an invalid deliver file is skipped with a warning', () => {
    const s = scene({config: {deploy: 'ship'}});
    runDelivery(s.deps);
    expect(s.probed).toEqual([]);
    expect(s.warns[0]).toContain('invalid');
  });

  test('a checkout that cannot reach the merged commit fails the delivery without running anything', () => {
    const s = scene({mergeFails: true});
    runDelivery(s.deps);
    expect(s.probed).toEqual([]);
    expect(s.events.map(e => e.kind)).toEqual(['delivery_failed']);
    expect(created(s.tracker)).toHaveLength(1);
  });

  test('a tracker that refuses the issue does not stop the rollback', () => {
    const s = scene({exits: {smoke: 1}});
    const run = s.deps.run;
    s.deps.run = cmd => {
      if (cmd.startsWith('gh issue')) throw new Error('rate limited');
      return run(cmd);
    };
    runDelivery(s.deps);
    expect(s.probed).toContain('revert');
    expect(s.warns[0]).toContain('Could not file');
  });
});
