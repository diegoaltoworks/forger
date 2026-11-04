import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import {formatViolations} from './docs-rules';
import {checkReadme, isCheckedReadme, splitSentences, type ReadmeRule} from './docs-readme';

const rules = (text: string, severity?: 'fail' | 'warn') =>
  checkReadme('README.md', text).filter(f => !severity || f.severity === severity).map(f => f.rule);

const words = (n: number) => Array.from({length: n}, () => 'word').join(' ');
const head = '# T\n\nThis tool does a thing for developers.\n\n';

describe('isCheckedReadme', () => {
  test.each([
    ['README.md', true],
    ['a/b/README.md', true],
    ['node_modules/x/README.md', false],
    ['a/fixtures/x/README.md', false],
    ['docs/guide.md', false],
  ])('%s -> %s', (file, expected) => expect(isCheckedReadme(file)).toBe(expected));
});

describe('the passing fixture', () => {
  test('has no findings of any kind', () => {
    const text = readFileSync(join(import.meta.dir, 'fixtures/readme/passing.md'), 'utf-8');
    expect(checkReadme('README.md', text)).toEqual([]);
  });
});

describe('purpose first', () => {
  test('a one-sentence purpose passes', () => expect(rules(head)).toEqual([]));
  test('a heading straight after the H1 fails', () => expect(rules('# T\n\n## Install\n\nRun it.\n')).toEqual(['readme-purpose']));
  test('a list straight after the H1 fails', () => expect(rules('# T\n\n- one\n- two\n')).toEqual(['readme-purpose']));
  test('three sentences fail', () => expect(rules('# T\n\nA is b. C is d. E is f.\n')).toEqual(['readme-purpose']));
  test('no H1 fails', () => expect(rules('Some text.\n')).toEqual(['readme-purpose']));
  test('a badge line before the purpose is allowed', () => expect(rules('# T\n\n![b](x.svg)\n\nA tool for people.\n')).toEqual([]));
});

describe('sentence length', () => {
  test('25 descriptive words pass, 26 fail', () => {
    expect(rules(head + words(25) + '.\n')).toEqual([]);
    expect(rules(head + words(26) + '.\n')).toEqual(['readme-sentence-length']);
  });
  test('20 procedural words pass, 21 fail', () => {
    expect(rules(head + '1. ' + words(20) + '.\n')).toEqual([]);
    expect(rules(head + '- ' + words(21) + '.\n')).toEqual(['readme-sentence-length']);
  });
  test('seven sentences in a paragraph fail', () => {
    expect(rules(head + Array(7).fill('It runs.').join(' ') + '\n')).toEqual(['readme-paragraph-length']);
  });
  test('a long sentence in a code block, table or quote is skipped', () => {
    const long = words(40) + '.';
    expect(rules(head + '```\n' + long + '\n```\n\n| a |\n| ' + long + ' |\n\n> ' + long + '\n')).toEqual([]);
  });
  test('a code span counts as one word', () => {
    expect(rules(head + 'Use `' + words(40) + '` now.\n')).toEqual([]);
  });
  test('e.g. does not end a sentence', () => {
    expect(splitSentences('Use a tool, e.g. a linter. Then stop.')).toHaveLength(2);
  });
  test('the finding names line and text', () => {
    const [f] = checkReadme('README.md', head + words(30) + '.\n');
    expect(f.line).toBe(5);
    expect(f.detail).toContain('30 words');
    expect(f.opinion).toBe('docs.readme-short-sentences');
  });
});

describe('active voice', () => {
  test('a passive construction warns and does not fail', () => {
    const text = head + 'The file is checked by the tool.\n';
    expect(rules(text, 'warn')).toEqual(['readme-passive-voice']);
    expect(rules(text, 'fail')).toEqual([]);
  });
  test('an active sentence is clean', () => expect(rules(head + 'The tool checks the file.\n')).toEqual([]));
});

describe('transient facts', () => {
  test.each([
    'It has 340 files in it.',
    'The status as of today is fine.',
    'It was written in Mar 2026.',
    'It was cut on 2026-03-01.',
    'It is currently fast.',
    'It runs at the moment.',
    'It changed recently.',
    'This is a new feature.',
    'It needs version 2.3 to run.',
  ])('refuses: %s', sentence => {
    expect(rules(head + sentence + '\n', 'fail')).toEqual(['readme-transient']);
  });
  test('a version inside a code span or fence is allowed', () => {
    expect(rules(head + 'Run `npm i x@1.2.3`.\n\n```\nv1.2.3 and 12 files\n```\n')).toEqual([]);
  });
  test('a number without a unit noun is allowed', () => expect(rules(head + 'It takes 3 steps.\n')).toEqual([]));
});

test('every rule id is reachable', () => {
  const seen = new Set<ReadmeRule>(checkReadme('README.md', 'x\n' + words(30) + '.\nIt is new and was made.\n').map(f => f.rule));
  expect([...seen].sort()).toEqual(['readme-passive-voice', 'readme-purpose', 'readme-sentence-length', 'readme-transient']);
});

describe('reporting', () => {
  test('each failure prints file, line, rule id and the offending text', () => {
    const out = formatViolations(checkReadme('pkg/README.md', head + 'It is new today.\n'));
    expect(out).toBe('pkg/README.md:5: readme-transient: a time-bound word: "new"');
  });
  test('a purpose failure quotes the paragraph that was found', () => {
    const [f] = checkReadme('README.md', '# T\n\n- one\n');
    expect(f.detail).toContain('one');
  });
});
