import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {mergeConfig} from '../config';
import {fileBacklog} from './file-backlog';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function tempFile(content: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'forger-backlog-'));
  dirs.push(dir);
  const file = join(dir, 'backlog.json');
  if (content !== null) writeFileSync(file, content);
  return file;
}

const config = mergeConfig({});

describe('fileBacklog', () => {
  test('selects from the tickets in the file', () => {
    const file = tempFile(
      JSON.stringify({
        features: {
          later: {status: 'not_started', priority: 'P2'},
          first: {status: 'not_started', priority: 'P0'},
          done: {status: 'completed', priority: 'P0'},
        },
      })
    );
    const backlog = fileBacklog(file, config);
    expect(backlog.next()).toBe('first');
    expect(backlog.remaining()).toBe(2);
    expect(backlog.isCompleted('done')).toBe(true);
    expect(backlog.has('later')).toBe(true);
  });

  test('reads the file once, and sees a worker edit on refresh', () => {
    const file = tempFile(JSON.stringify({features: {a: {status: 'not_started'}}}));
    const backlog = fileBacklog(file, config);
    expect(backlog.next()).toBe('a');
    writeFileSync(file, JSON.stringify({features: {a: {status: 'completed'}}}));
    expect(backlog.next()).toBe('a');
    backlog.refresh();
    expect(backlog.next()).toBeNull();
    expect(backlog.isCompleted('a')).toBe(true);
  });

  test('a missing or unparsable file reads as an empty backlog', () => {
    for (const file of [tempFile(null), tempFile('{not json')]) {
      const backlog = fileBacklog(file, config);
      expect(backlog.remaining()).toBe(0);
      expect(backlog.next()).toBeNull();
      expect(backlog.report()).toEqual({workable: [], remaining: 0, next: null});
    }
  });
});
