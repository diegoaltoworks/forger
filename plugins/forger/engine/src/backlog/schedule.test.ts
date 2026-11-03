import {describe, expect, test} from 'bun:test';

import type {FolderMap, Schedulable, ScheduleReason} from './schedule';
import {
  isSerialClass,
  parseFootprint,
  pick,
  resolveFolders,
  rootsFromModulePaths,
  schedule,
} from './schedule';

const src = 'plugins/forger/engine/src';
const map: FolderMap = {
  roots: [src],
  folders: ['checks', 'loop', 'backlog', 'cli', 'migrate'].map(f => `${src}/${f}`),
};

function ticket(id: string, knockOn: string | null, serial = false): Schedulable {
  return {
    id,
    footprint: knockOn === null ? null : parseFootprint(`## Knock-on\n${knockOn}\n`),
    serial,
  };
}

describe('parseFootprint', () => {
  test('reads backticked paths and "<name> module" phrases', () => {
    expect(parseFootprint('## Knock-on\n`loop/merge.ts`, the backlog module and `docs/a.md/`\n\n## Next\n`x/y`')).toEqual({
      paths: ['loop/merge.ts', 'docs/a.md'],
      modules: ['backlog'],
    });
  });

  test('no section, empty section or none is unknown', () => {
    expect(parseFootprint('## What\nx')).toBeNull();
    expect(parseFootprint('## Knock-on\n\n## Next')).toBeNull();
    expect(parseFootprint('## Knock-on\nnone')).toBeNull();
  });
});

describe('resolveFolders', () => {
  test('full paths, relative paths and module names resolve to folders', () => {
    const fp = {paths: [`${src}/cli/x.ts`, 'loop/merge.ts', 'docs/a.md'], modules: ['backlog']};
    expect(resolveFolders(fp, map).sort()).toEqual(
      [`${src}/backlog`, `${src}/cli`, `${src}/loop`].sort()
    );
  });

  test('module roots come from the architecture globs', () => {
    expect(rootsFromModulePaths([`${src}/*`])).toEqual([src]);
  });
});

describe('schedule: the ADR example pairs', () => {
  const cases: Array<[string, Schedulable, Schedulable, 'parallel' | 'serial', ScheduleReason]> = [
    ['disjoint folders', ticket('a', '`checks/new.ts`'), ticket('b', '`docs/guide.md`'), 'parallel', 'disjoint'],
    ['same folder', ticket('a', '`loop/merge.ts`'), ticket('b', '`loop/outcome.ts`'), 'serial', 'same-folder'],
    ['disjoint, no dependency', ticket('a', '`loop/merge.ts`'), ticket('b', '`backlog/github-backlog.ts`'), 'parallel', 'disjoint'],
    ['unknown footprint', ticket('a', '`packs/x/file.json`'), ticket('b', null), 'serial', 'unknown-footprint'],
    ['same path', ticket('a', '`docs/02-the-loop.md`'), ticket('b', '`docs/02-the-loop.md`'), 'serial', 'same-path'],
    ['a path contains the other', ticket('a', '`docs/`'), ticket('b', '`docs/a.md`'), 'serial', 'same-path'],
    ['serial label', ticket('a', '`loop/state.ts`', true), ticket('b', '`checks/x.ts`'), 'serial', 'serial-class'],
  ];
  for (const [name, a, b, verdict, reason] of cases) {
    test(name, () => {
      expect(schedule(a, b, map)).toEqual({verdict, reason});
      expect(schedule(b, a, map)).toEqual({verdict, reason});
    });
  }

  test('dependent, directly and transitively', () => {
    const a = ticket('a', '`cli/merge.ts`');
    const c = ticket('c', '`loop/merge.ts`');
    expect(schedule(a, c, map, {graph: {c: ['a']}})).toEqual({verdict: 'serial', reason: 'dependent'});
    expect(schedule(a, c, map, {graph: {c: ['b'], b: ['a']}})).toEqual({
      verdict: 'serial',
      reason: 'dependent',
    });
  });

  test('a dependency cycle terminates', () => {
    const a = ticket('a', '`cli/x.ts`');
    const b = ticket('b', '`loop/x.ts`');
    expect(schedule(a, b, map, {graph: {x: ['y'], y: ['x'], a: ['x']}}).verdict).toBe('parallel');
  });

  test('configured patterns make a migration serial-class', () => {
    const m = ticket('m', '`migrate/001.ts`');
    expect(isSerialClass(m, [`migrate/*`])).toBe(true);
    expect(schedule(m, ticket('d', '`docs/a.md`'), map, {serialPatterns: ['migrate/']})).toEqual({
      verdict: 'serial',
      reason: 'serial-class',
    });
  });
});

describe('pick', () => {
  const a = ticket('a', '`loop/a.ts`');
  const b = ticket('b', '`loop/b.ts`');
  const c = ticket('c', '`checks/c.ts`');
  const d = ticket('d', '`docs/d.md`');

  test('parallelism 1 returns exactly the first candidate', () => {
    expect(pick([a, b, c], [], 1, map).map(t => t.id)).toEqual(['a']);
    expect(pick([ticket('u', null), c], [], 1, map).map(t => t.id)).toEqual(['u']);
  });

  test('skips a conflicting candidate and keeps the order', () => {
    expect(pick([a, b, c, d], [], 2, map).map(t => t.id)).toEqual(['a', 'c']);
    expect(pick([a, b, c, d], [], 3, map).map(t => t.id)).toEqual(['a', 'c', 'd']);
  });

  test('accounts for running tickets and open slots', () => {
    expect(pick([b, c], [a], 2, map).map(t => t.id)).toEqual(['c']);
    expect(pick([c], [a], 1, map)).toEqual([]);
  });

  test('a serial-class ticket runs alone', () => {
    const s = ticket('s', '`checks/s.ts`', true);
    expect(pick([s, c, d], [], 3, map).map(t => t.id)).toEqual(['s']);
    expect(pick([c], [s], 3, map)).toEqual([]);
  });

  test('a candidate that depends on a running ticket waits', () => {
    expect(pick([c], [a], 2, map, {graph: {c: ['a']}})).toEqual([]);
  });
});
