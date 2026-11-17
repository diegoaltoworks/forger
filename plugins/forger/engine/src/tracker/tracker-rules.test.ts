import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync} from 'fs';
import {join, relative} from 'path';

const SRC = join(import.meta.dir, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

function find(pattern: RegExp, skip: (rel: string) => boolean): string[] {
  const hits: string[] = [];
  for (const file of sources(SRC)) {
    const rel = relative(SRC, file);
    if (skip(rel)) continue;
    readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('the tracker port stays whole', () => {
  test('no engine file outside the tracker folder names a gh issue or gh label command', () => {
    expect(find(/gh (issue|label)/, rel => rel.startsWith('tracker/'))).toEqual([]);
  });

  test('no engine file outside the config and tracker folders reads the tracker kind', () => {
    const setup = new Set(['cli/setup.ts', 'packs/setup.ts']);
    const hits = find(/tracker\.kind|trackerKind|\bkind\b[^=\n]*\}\s*=\s*[\w.]*tracker\b/, rel => /^(config|tracker)\//.test(rel) || setup.has(rel));
    expect(hits).toEqual([]);
  });
});
