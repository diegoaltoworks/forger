import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {parseSafetyConfig} from '../../checks';
import {checkTicketCriteria} from '../criteria';
import {eventLine, terminalEvent, type EventKind} from '../events';
import {accessReviewDue} from './access-review';
import {fileAccessReview} from './access-review-io';
import {fileStructureReview} from './structure-review-io';

const TEMPLATE = join(import.meta.dir, '../../../../packs/safety/files/access-review.md');
const STRUCTURE_TEMPLATE = join(import.meta.dir, '../../../../packs/structure/files/structure-review.md');

const text = (...kinds: EventKind[]) => kinds.map(k => eventLine(terminalEvent(k, 1, null, null))).join('');
const many = (n: number): EventKind[] => Array.from({length: n}, () => 'merged' as const);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function project(files: Record<string, object>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-access-review-'));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, '.forger', name), JSON.stringify(body));
  return root;
}
const safety = (everyMerged?: number) => ({'safety.json': {migration_paths: ['m/**'], data_test_paths: ['t/**'], ...(everyMerged === undefined ? {} : {access_review: {every_merged: everyMerged}})}});
function tracker(open = '') {
  const commands: string[] = [];
  return {commands, run: (cmd: string): string => (commands.push(cmd), cmd.includes('issue list') ? open : '')};
}
const body = readFileSync(TEMPLATE, 'utf-8');
const created = (t: {commands: string[]}) => t.commands.filter(c => c.includes('issue create'));

describe('access review', () => {
  test('an access review is due after every_merged merges since the last one', () => {
    const t = tracker();
    const root = project(safety(3));
    expect(fileAccessReview(root, t.run, 'ready-for-agent', text(...many(2)), body)).toBeNull();
    const reason = fileAccessReview(root, t.run, 'ready-for-agent', text(...many(3)), body);
    expect(reason).toContain('every_merged 3');
    expect(created(t)).toHaveLength(1);
    expect(created(t)[0]).toContain("--label 'access-review'");
    expect(created(t)[0]).toContain("--label 'ready-for-agent'");
    expect(fileAccessReview(root, tracker().run, 'ready-for-agent', text('merged', 'merged', 'access_review_filed', 'merged'), body)).toBeNull();
  });

  test('no access review is filed while one is open', () => {
    const t = tracker('12\n');
    expect(fileAccessReview(project(safety(1)), t.run, 'ready-for-agent', text(...many(5)), body)).toBeNull();
    expect(created(t)).toHaveLength(0);
    expect(accessReviewDue(1, {merged: 5, reviewOpen: true})).toBeNull();
  });

  test('every_merged of 0 files none', () => {
    const t = tracker();
    expect(fileAccessReview(project(safety(0)), t.run, 'ready-for-agent', text(...many(99)), body)).toBeNull();
    expect(fileAccessReview(project(safety()), t.run, 'ready-for-agent', text(...many(99)), body)).toBeNull();
    expect(t.commands).toEqual([]);
  });

  test('a project without the safety pack is left alone', () => {
    const t = tracker();
    expect(fileAccessReview(project({}), t.run, 'ready-for-agent', text(...many(99)), body)).toBeNull();
    expect(t.commands).toEqual([]);
  });

  test('the structure review is still filed on its own schedule', () => {
    const t = tracker();
    const root = project({...safety(2), 'structure.json': {review: {every_merged: 3, warnings_over: 0}}});
    const events = text('merged', 'merged', 'access_review_filed', 'merged');
    expect(fileStructureReview(root, t.run, 'ready-for-agent', events, readFileSync(STRUCTURE_TEMPLATE, 'utf-8'))).toContain('3 tickets merged');
    expect(created(t)[0]).toContain("--label 'structure-review'");
  });

  test('the config rejects a bad every_merged', () => {
    expect(() => parseSafetyConfig(JSON.stringify({migration_paths: ['a'], data_test_paths: ['b'], access_review: {every_merged: -1}}))).toThrow('every_merged');
    expect(() => parseSafetyConfig(JSON.stringify({migration_paths: ['a'], data_test_paths: ['b'], access_review: 3}))).toThrow('every_merged');
  });

  test("the filed review's acceptance criteria pass check ticket", () => {
    const check = checkTicketCriteria(body);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });
});
