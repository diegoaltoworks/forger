import {describe, expect, test} from 'bun:test';

import {resolveSubject} from './verify-subject';

const base = {trackerKind: 'github' as const, inBacklog: () => false};

describe('resolveSubject', () => {
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
    const s = resolveSubject({branch: 'feat/sim-engine', body: '', trackerKind: 'local', inBacklog: id => id === 'sim-engine'});
    expect(s).toEqual({kind: 'ticket', ticket: 'sim-engine'});
  });
  test('on a local tracker a branch outside the backlog falls back to the body, then refuses', () => {
    const local = {trackerKind: 'local' as const, inBacklog: () => false};
    expect(resolveSubject({...local, branch: 'feat/x', body: '## Acceptance\n- [ ] a'}).kind).toBe('body');
    expect(() => resolveSubject({...local, branch: 'feat/x', body: ''})).toThrow('cannot tell');
  });
});
