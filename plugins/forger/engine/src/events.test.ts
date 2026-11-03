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
