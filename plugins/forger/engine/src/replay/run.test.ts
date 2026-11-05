import {expect, test} from 'bun:test';

import {parseRequests, planReplay} from './replay';
import {fileReplay} from './run';

test('files in order, then links the blockers of each dependent', () => {
  const p = parseRequests(JSON.stringify({requests: [{id: 'a', title: 'A', body: 'one'}, {id: 'b', title: 'B', blockedBy: ['a']}]}));
  if (!p.ok) throw new Error('unreachable');
  const calls: string[] = [];
  let n = 10;
  const run = (cmd: string): string => {
    calls.push(cmd);
    if (cmd.startsWith('gh issue create')) return `https://github.com/o/r/issues/${++n}\n`;
    if (cmd.includes('-F number=12')) return JSON.stringify({data: {repository: {issue: {id: 'B', body: '## Blocked by\n- #11', blockedBy: {nodes: []}}}}});
    if (cmd.includes('-F number=11')) return JSON.stringify({data: {repository: {issue: {id: 'A', body: 'one', blockedBy: {nodes: []}}}}});
    return '';
  };
  const filed = fileReplay(run, planReplay(p.requests), 'ready-for-agent');
  expect(filed.map(f => [f.id, f.number, f.blockedBy])).toEqual([['a', 11, []], ['b', 12, [11]]]);
  const creates = calls.filter(c => c.startsWith('gh issue create'));
  expect(creates[0]).toContain("--label 'ready-for-agent'");
  expect(creates[1]).toContain('## Blocked by\n- #11');
  expect(calls.findIndex(c => c.includes('addBlockedBy'))).toBeGreaterThan(calls.indexOf(creates[1]));
});
