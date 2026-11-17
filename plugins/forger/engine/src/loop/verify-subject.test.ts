import {describe, expect, test} from 'bun:test';

import {closingReferenceRefusal, resolveSubject} from './verify-subject';

const base = {ticketNaming: 'closing-reference' as const, inBacklog: () => false};

describe('resolveSubject', () => {
  test('resolveSubject is told how a pull request names its ticket', () => {
    expect(resolveSubject({branch: 'feat/issue-3', body: '', ticketNaming: 'closing-reference', inBacklog: () => true})).toEqual({kind: 'ticket', ticket: 'issue-3'});
    expect(resolveSubject({branch: 'feat/issue-3', body: '', ticketNaming: 'backlog-id', inBacklog: () => true})).toEqual({kind: 'ticket', ticket: 'issue-3'});
    expect(() => resolveSubject({branch: 'feat/issue-3', body: '', ticketNaming: 'backlog-id', inBacklog: () => false})).toThrow();
  });

  test('a closing reference in the body names the ticket when the branch does not', () => {
    expect(resolveSubject({...base, branch: 'docs/x', body: 'text\n\nCloses #206\n'})).toEqual({kind: 'ticket', ticket: 'issue-206'});
  });
  test('the closing reference wins over the branch name', () => {
    expect(resolveSubject({...base, branch: 'feat/issue-3', body: 'Fixes #4'})).toEqual({kind: 'ticket', ticket: 'issue-4'});
  });
  test('the branch names the ticket when the body has no closing line', () => {
    expect(resolveSubject({...base, branch: 'feat/issue-3', body: 'nothing'})).toEqual({kind: 'ticket', ticket: 'issue-3'});
  });
  test('a PR with an Acceptance section and no ticket is verified against the section', () => {
    const s = resolveSubject({...base, branch: 'docs/x', body: '## Summary\n- [ ] not this\n## Acceptance\n- [ ] a\n- [ ] b\n'});
    expect(s).toEqual({kind: 'body', criteria: [{id: 'c1', text: 'a'}, {id: 'c2', text: 'b'}]});
  });
  test('checkboxes without an Acceptance heading are not criteria', () => {
    expect(() => resolveSubject({...base, branch: 'docs/x', body: '- [ ] a'})).toThrow();
  });
  test('a PR with neither is refused, naming both fixes', () => {
    expect(() => resolveSubject({...base, branch: 'wip', body: ''})).toThrow(/Closes #<n>.*## Acceptance/);
  });
  test('on a local tracker the branch feat/<id> names a backlog ticket', () => {
    const s = resolveSubject({branch: 'feat/sim-engine', body: '', ticketNaming: 'backlog-id', inBacklog: id => id === 'sim-engine'});
    expect(s).toEqual({kind: 'ticket', ticket: 'sim-engine'});
  });
  test('on a local tracker a branch outside the backlog falls back to the body, then refuses', () => {
    const local = {ticketNaming: 'backlog-id' as const, inBacklog: () => false};
    expect(resolveSubject({...local, branch: 'feat/x', body: '## Acceptance\n- [ ] a'}).kind).toBe('body');
    expect(() => resolveSubject({...local, branch: 'feat/x', body: ''})).toThrow('cannot tell');
  });
});

describe('a pull request on a tracker that names tickets by a key in the title', () => {
  const keyed = {ticketNaming: 'key-in-title' as const, inBacklog: () => false, ticketOfTitle: (t: string) => Number(/^ABC-(\d+)/.exec(t)?.[1]) || null};

  test("a pull request's ticket is read from the key in its title, then from its branch, never from a closing reference", () => {
    expect(resolveSubject({...keyed, branch: 'feat/issue-3', body: '', title: 'ABC-8: x'})).toEqual({kind: 'ticket', ticket: 'issue-8'});
    expect(resolveSubject({...keyed, branch: 'feat/issue-3', body: '', title: 'feat: x'})).toEqual({kind: 'ticket', ticket: 'issue-3'});
    expect(() => resolveSubject({...keyed, branch: 'docs/x', body: 'Closes #5', title: 'feat: x'})).toThrow(/closing reference/);
    expect(() => resolveSubject({...keyed, branch: 'feat/issue-3', body: 'Closes #5', title: 'ABC-3: x'})).toThrow(/closing reference/);
  });

  test('the refusal names the closing reference and only applies to this naming', () => {
    expect(closingReferenceRefusal('key-in-title', 'text\nthis fixes #12 too')).toContain('"fixes #12"');
    expect(closingReferenceRefusal('key-in-title', 'no reference, issue #12 is related')).toBeNull();
    expect(closingReferenceRefusal('closing-reference', 'Closes #5')).toBeNull();
    expect(closingReferenceRefusal('backlog-id', 'Closes #5')).toBeNull();
  });
});
