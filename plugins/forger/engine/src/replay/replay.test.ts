import {describe, expect, test} from 'bun:test';

import {issueBody, parseRequests, planReplay} from './replay';

const SET = JSON.stringify({
  requests: [
    {id: 'save', title: 'Save a link', body: 'From a form.'},
    {id: 'tag', title: 'Tag a link', body: 'Filter by tag.', blockedBy: ['save']},
    {id: 'dupe', title: 'Reject a duplicate', blockedBy: ['save', 'tag']},
  ],
});

describe('parseRequests', () => {
  test('reads the set in order', () => {
    const p = parseRequests(SET);
    expect(p.ok && p.requests.map(r => r.id)).toEqual(['save', 'tag', 'dupe']);
  });
  test('rejects bad JSON, empty sets, duplicate ids and forward references', () => {
    expect(parseRequests('{').ok).toBe(false);
    expect(parseRequests('{"requests":[]}').ok).toBe(false);
    const dup = parseRequests(JSON.stringify({requests: [{id: 'a', title: 'A'}, {id: 'a', title: 'B'}]}));
    expect(!dup.ok && dup.problems[0]).toContain('used twice');
    const fwd = parseRequests(JSON.stringify({requests: [{id: 'a', title: 'A', blockedBy: ['b']}, {id: 'b', title: 'B'}]}));
    expect(!fwd.ok && fwd.problems[0]).toContain('not an earlier request');
  });
  test('reports a missing title', () => {
    const p = parseRequests(JSON.stringify({requests: [{id: 'a'}]}));
    expect(!p.ok && p.problems).toEqual(['request 1: title is required']);
  });
});

describe('planReplay and issueBody', () => {
  test('numbers the plan from 1 in set order', () => {
    const p = parseRequests(SET);
    if (!p.ok) throw new Error('unreachable');
    expect(planReplay(p.requests).map(x => x.position)).toEqual([1, 2, 3]);
  });
  test('renders the blockers under a Blocked by heading', () => {
    const p = parseRequests(SET);
    if (!p.ok) throw new Error('unreachable');
    const plan = planReplay(p.requests);
    expect(issueBody(plan[0], {})).toBe('From a form.');
    expect(issueBody(plan[2], {save: 5, tag: 6})).toBe('## Blocked by\n- #5\n- #6');
  });
});
