import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {checkTicketCriteria} from '../criteria';
import {eventLine, terminalEvent, type EventKind} from '../events';
import {mergesSinceReview, reviewDue} from './structure-review';
import {fileStructureReview} from './structure-review-io';

const TEMPLATE = join(import.meta.dir, '../../../../packs/structure/files/structure-review.md');

const events = (...kinds: EventKind[]) => kinds.map(k => terminalEvent(k, 1, null, null));
const text = (...kinds: EventKind[]) => events(...kinds).map(eventLine).join('');
const many = (n: number): EventKind[] => Array.from({length: n}, () => 'merged' as const);

describe('mergesSinceReview', () => {
  test('counts from the start when no review was filed', () => {
    expect(mergesSinceReview(events('picked', 'merged', 'merged'))).toBe(2);
  });
  test('restarts at the last filed review', () => {
    expect(mergesSinceReview(events('merged', 'merged', 'structure_review_filed', 'merged'))).toBe(1);
  });
});

describe('reviewDue', () => {
  const cfg = {every_merged: 5, warnings_over: 10};
  const facts = {merged: 0, baselineEntries: 0, reviewOpen: false};
  test('a merge that brings the count to every_merged is due, and says why', () => {
    expect(reviewDue(cfg, {...facts, merged: 4})).toBeNull();
    expect(reviewDue(cfg, {...facts, merged: 5})).toContain('every_merged 5');
  });
  test('a baseline over warnings_over is due early', () => {
    expect(reviewDue(cfg, {...facts, baselineEntries: 10})).toBeNull();
    expect(reviewDue(cfg, {...facts, baselineEntries: 11})).toContain('warnings_over 10');
  });
  test('no review is due while one is open', () => {
    expect(reviewDue(cfg, {merged: 50, baselineEntries: 50, reviewOpen: true})).toBeNull();
  });
  test('a threshold of 0 turns that trigger off', () => {
    expect(reviewDue({every_merged: 0, warnings_over: 10}, {...facts, merged: 99})).toBeNull();
    expect(reviewDue({every_merged: 5, warnings_over: 0}, {...facts, baselineEntries: 99})).toBeNull();
  });
});

describe('fileStructureReview', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
  });
  function project(review: object, entries = 0): string {
    const root = mkdtempSync(join(tmpdir(), 'forger-structure-review-'));
    dirs.push(root);
    mkdirSync(join(root, '.forger'));
    writeFileSync(join(root, '.forger/structure.json'), JSON.stringify({review}));
    writeFileSync(join(root, '.forger/structure-baseline.json'), JSON.stringify({entries: Array.from({length: entries}, (_, i) => ({rule: 'structure.folder-size', path: `d${i}`, count: 20}))}));
    return root;
  }
  function tracker(open = '') {
    const commands: string[] = [];
    return {commands, run: (cmd: string): string => (commands.push(cmd), cmd.includes('issue list') ? open : '')};
  }
  const body = readFileSync(TEMPLATE, 'utf-8');

  test('a merge that brings the count to every_merged files one structure review and records why', () => {
    const t = tracker();
    const reason = fileStructureReview(project({every_merged: 3, warnings_over: 0}), t.run, 'ready-for-agent', text(...many(3)), body);
    expect(reason).toContain('3 tickets merged');
    const created = t.commands.filter(c => c.includes('issue create'));
    expect(created).toHaveLength(1);
    expect(created[0]).toContain("--label 'structure-review'");
    expect(created[0]).toContain("--label 'ready-for-agent'");
  });

  test('a baseline over warnings_over files a structure review early', () => {
    const t = tracker();
    const reason = fileStructureReview(project({every_merged: 0, warnings_over: 2}, 3), t.run, 'ready-for-agent', text('merged'), body);
    expect(reason).toContain('3 entries');
    expect(t.commands.some(c => c.includes('issue create'))).toBe(true);
  });

  test('no review is filed while one with the structure-review label is open', () => {
    const t = tracker('77\n');
    expect(fileStructureReview(project({every_merged: 1, warnings_over: 0}), t.run, 'ready-for-agent', text(...many(5)), body)).toBeNull();
    expect(t.commands.some(c => c.includes('issue create'))).toBe(false);
  });

  test('a threshold of 0 turns that trigger off', () => {
    const t = tracker();
    expect(fileStructureReview(project({every_merged: 0, warnings_over: 0}, 99), t.run, 'ready-for-agent', text(...many(99)), body)).toBeNull();
  });

  test('a project without the structure pack is left alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-structure-review-'));
    dirs.push(root);
    const t = tracker();
    expect(fileStructureReview(root, t.run, 'ready-for-agent', text(...many(99)), body)).toBeNull();
    expect(t.commands).toEqual([]);
  });

  test('the filed review\'s acceptance criteria pass check ticket', () => {
    const check = checkTicketCriteria(body);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });
});
