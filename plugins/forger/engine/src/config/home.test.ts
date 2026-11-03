import {describe, expect, test} from 'bun:test';

import {homeOf, type Home} from './home';
import {OWNED} from './layout';

describe('homeOf', () => {
  const cases: Array<[string, Home]> = [
    ['.forger/workloop.config.json', 'main'],
    ['.forger/opinions/x.md', 'main'],
    ['.forger/inbox/a.md', 'main'],
    ['.forger/backlog.json', 'main'],
    ['.forger/templates.upstream/x', 'main'],
    ['.forger/state.json', 'state'],
    ['.forger/events.jsonl', 'state'],
    ['.forger/events/2026-01-02.jsonl', 'state'],
    ['.forger/lease.json', 'state'],
    ['.forger/HALT', 'tracker'],
    ['.forger/output/iteration-3.log', 'local'],
    ['.forger/work.log', 'local'],
    ['.forger/runner.lock', 'local'],
    ['state.json', 'state'],
  ];
  for (const [path, home] of cases) {
    test(`${path} is ${home}`, () => expect(homeOf(path)).toBe(home));
  }

  test('every owned entry has a home', () => {
    for (const entry of OWNED) expect(() => homeOf(entry)).not.toThrow();
  });

  test('an unlisted path is an error, not a default', () => {
    expect(() => homeOf('.forger/surprise.json')).toThrow('no home');
    expect(() => homeOf('constructor')).toThrow('no home');
  });
});
