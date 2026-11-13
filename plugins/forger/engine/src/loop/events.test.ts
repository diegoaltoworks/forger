import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {appendEvent, eventLine, terminalEvent} from './events';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

describe('terminal events', () => {
  test('a line is one JSON object with a fixed shape', () => {
    const e = terminalEvent('stalled', 4, 't', 'why', new Date('2000-01-02T03:04:05.000Z'));
    expect(eventLine(e)).toBe(
      '{"event":"stalled","at":"2000-01-02T03:04:05.000Z","iteration":4,"ticket":"t","reason":"why"}\n'
    );
  });

  test('appends, never rewrites', () => {
    const d = mkdtempSync(join(tmpdir(), 'forger-events-'));
    dirs.push(d);
    const f = join(d, 'events.jsonl');
    appendEvent(f, terminalEvent('halted', 1, null, 'a'));
    appendEvent(f, terminalEvent('completed', 2, null, null));
    const lines = readFileSync(f, 'utf-8').trimEnd().split('\n');
    expect(lines.map(l => JSON.parse(l).event)).toEqual(['halted', 'completed']);
  });
});

import {writeFileSync} from 'fs';
import {awaitEvent, parseEvents, readEvents} from './events';

describe('reading events', () => {
  test('parseEvents skips blank, torn and unknown lines', () => {
    const good = eventLine(terminalEvent('halted', 1, null, 'r'));
    expect(parseEvents(`${good}\n{"event":"halt\n{"event":"other"}\n`).map(e => e.event)).toEqual(['halted']);
  });
  test('a missing file has no events', () => {
    expect(readEvents('/nonexistent/events.jsonl')).toEqual([]);
  });
  test('awaitEvent returns the first event past those seen, or null at the deadline', async () => {
    const d = mkdtempSync(join(tmpdir(), 'forger-ev-'));
    dirs.push(d);
    const f = join(d, 'e.jsonl');
    let slept = 0;
    const sleep = async (): Promise<void> => {
      slept++;
      if (slept === 2) appendEvent(f, terminalEvent('completed', 3, null, null));
    };
    const e = await awaitEvent(f, 0, 10_000, sleep, 1000);
    expect(e?.event).toBe('completed');
    writeFileSync(f, eventLine(terminalEvent('completed', 3, null, null)));
    expect(await awaitEvent(f, 1, 2000, async () => {}, 1000)).toBeNull();
  });
});

import {RECORDED_EVENTS, parseAllEvents, readAllEvents} from './events';

describe('recorded events', () => {
  const at = new Date('2000-01-02T03:04:05.000Z');
  const cases: [Parameters<typeof terminalEvent>, string][] = [
    [['picked', 7, 'issue-9', null, at], '{"event":"picked","at":"2000-01-02T03:04:05.000Z","iteration":7,"ticket":"issue-9","reason":null}\n'],
    [['approval_asked', 0, null, 'clear_halt: owner', at], '{"event":"approval_asked","at":"2000-01-02T03:04:05.000Z","iteration":0,"ticket":null,"reason":"clear_halt: owner"}\n'],
    [['halt_cleared', 3, 'issue-9', 'why', at], '{"event":"halt_cleared","at":"2000-01-02T03:04:05.000Z","iteration":3,"ticket":"issue-9","reason":"why"}\n'],
    [['lease_takeover', 2, null, 'took over', at], '{"event":"lease_takeover","at":"2000-01-02T03:04:05.000Z","iteration":2,"ticket":null,"reason":"took over"}\n'],
    [['contract_attempt', 4, 'issue-9', 'review attempt 1: x', at], '{"event":"contract_attempt","at":"2000-01-02T03:04:05.000Z","iteration":4,"ticket":"issue-9","reason":"review attempt 1: x"}\n'],
    [['owner_review', 5, 'issue-9', 'PR #12', at], '{"event":"owner_review","at":"2000-01-02T03:04:05.000Z","iteration":5,"ticket":"issue-9","reason":"PR #12"}\n'],
    [['probe_failed', 6, 'issue-9', '`x` exits 0', at], '{"event":"probe_failed","at":"2000-01-02T03:04:05.000Z","iteration":6,"ticket":"issue-9","reason":"`x` exits 0"}\n'],
    [['merged', 8, 'issue-9', null, at], '{"event":"merged","at":"2000-01-02T03:04:05.000Z","iteration":8,"ticket":"issue-9","reason":null}\n'],
    [['structure_review_filed', 8, null, 'why', at], '{"event":"structure_review_filed","at":"2000-01-02T03:04:05.000Z","iteration":8,"ticket":null,"reason":"why"}\n'],
    [['access_review_filed', 8, null, 'why', at], '{"event":"access_review_filed","at":"2000-01-02T03:04:05.000Z","iteration":8,"ticket":null,"reason":"why"}\n'],
    [['set_aside', 9, 'issue-9', 'needs a key', at], '{"event":"set_aside","at":"2000-01-02T03:04:05.000Z","iteration":9,"ticket":"issue-9","reason":"needs a key"}\n'],
    [['delivered', 10, 'issue-9', 'PR #12: ok', at], '{"event":"delivered","at":"2000-01-02T03:04:05.000Z","iteration":10,"ticket":"issue-9","reason":"PR #12: ok"}\n'],
    [['delivery_failed', 10, 'issue-9', 'PR #12: check failed', at], '{"event":"delivery_failed","at":"2000-01-02T03:04:05.000Z","iteration":10,"ticket":"issue-9","reason":"PR #12: check failed"}\n'],
    [['rolled_back', 10, 'issue-9', 'PR #12: undone', at], '{"event":"rolled_back","at":"2000-01-02T03:04:05.000Z","iteration":10,"ticket":"issue-9","reason":"PR #12: undone"}\n'],
    [['flaky_gate', 11, null, 'PR #12: test (a > b)', at], '{"event":"flaky_gate","at":"2000-01-02T03:04:05.000Z","iteration":11,"ticket":null,"reason":"PR #12: test (a > b)"}\n'],
    [['rollback_failed', 10, 'issue-9', 'PR #12: no way back', at], '{"event":"rollback_failed","at":"2000-01-02T03:04:05.000Z","iteration":10,"ticket":"issue-9","reason":"PR #12: no way back"}\n'],
  ];
  test.each(cases)('%j is written as one fixed line', (args, line) => {
    expect(eventLine(terminalEvent(...args))).toBe(line);
  });
  test('every recorded kind has a case', () => {
    expect(cases.map(c => c[0][0]).sort()).toEqual([...RECORDED_EVENTS].sort());
  });
  test('terminal readers skip them and existing terminal lines read unchanged', () => {
    const terminal = '{"event":"halted","at":"2000-01-02T03:04:05.000Z","iteration":1,"ticket":null,"reason":"r"}\n';
    const text = eventLine(terminalEvent('picked', 1, 't', null)) + terminal + eventLine(terminalEvent('halt_cleared', 1, null, 'r'));
    expect(parseEvents(text).map(e => e.event)).toEqual(['halted']);
    expect(parseEvents(text)[0]).toEqual({event: 'halted', at: '2000-01-02T03:04:05.000Z', iteration: 1, ticket: null, reason: 'r'});
    expect(parseAllEvents(text).map(e => e.event)).toEqual(['picked', 'halted', 'halt_cleared']);
  });
  test('a missing file has none', () => {
    expect(readAllEvents('/nonexistent/events.jsonl')).toEqual([]);
  });
});
