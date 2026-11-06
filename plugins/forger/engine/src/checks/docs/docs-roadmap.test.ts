import {describe, expect, test} from 'bun:test';

import {checkRoadmap} from './docs-roadmap';

const I = '[#9](https://github.com/o/r/issues/9)';

describe('checkRoadmap', () => {
  test('passes items that link an issue, including a continued line', () => {
    expect(checkRoadmap(`## 1. A\n\n- one ${I}\n- two\n  continues ${I}\n`)).toEqual([]);
  });
  test('fails a roadmap item with no issue link', () => {
    expect(checkRoadmap(`## 1. A\n\n- one ${I}\n- two\n`).map(p => p.line)).toEqual([4]);
  });
  test('a link to a doc is not an issue link', () => {
    expect(checkRoadmap('## 1. A\n\n- one [ADR](adr/0001.md)\n')).toHaveLength(1);
  });
  test('lists outside numbered sections are free', () => {
    expect(checkRoadmap('## Settled\n\n- a thing\n')).toEqual([]);
  });
});
