import {describe, expect, test} from 'bun:test';

import {mergeOverlay} from './overlay';
import type {Definition} from './types';

const DEF: Definition = {
  version: 1,
  stages: [
    {id: 'build', command: 'auto-ticket', inputs: [], slots: [{slot: 'test_first', contract: 'tests_written'}], gate: 'gates'},
    {id: 'review', command: 'auto-ticket', inputs: [], slots: [{slot: 'review', contract: 'review_findings'}], gate: 'contract review_findings'},
  ],
};

const ids = (d: Definition): string[] => d.stages.map(s => s.id);

describe('mergeOverlay', () => {
  test('no overlay is the definition untouched', () => {
    const m = mergeOverlay(DEF, undefined);
    expect(m.definition).toEqual(DEF);
    expect(m.problems).toEqual([]);
  });

  const cases: Array<{name: string; overlay: unknown; check: (m: ReturnType<typeof mergeOverlay>) => void}> = [
    {
      name: 'disable a stage',
      overlay: {disable: ['review']},
      check: m => {
        expect(ids(m.definition)).toEqual(['build']);
        expect(m.disabled).toEqual(['review']);
        expect(m.problems).toEqual([]);
      },
    },
    {
      name: 'add a slot after the stage own slots',
      overlay: {add: [{stage: 'review', slot: {slot: 'review_security', contract: 'review_findings'}}]},
      check: m => {
        expect(m.definition.stages[1]?.slots.map(s => s.slot)).toEqual(['review', 'review_security']);
        expect(m.problems).toEqual([]);
      },
    },
    {
      name: 'replace a gate',
      overlay: {gates: {build: 'make test'}},
      check: m => {
        expect(m.definition.stages[0]?.gate).toBe('make test');
        expect(m.definition.stages[1]?.gate).toBe('contract review_findings');
      },
    },
    {
      name: 'an unknown stage is reported in each section and changes nothing',
      overlay: {disable: ['nope'], add: [{stage: 'nope', slot: {slot: 'x', contract: 'y'}}], gates: {nope: 'z'}},
      check: m => {
        expect(m.definition).toEqual(DEF);
        expect(m.problems).toEqual(['overlay.disable: unknown stage "nope"', 'overlay.add[0]: unknown stage "nope"', 'overlay.gates: unknown stage "nope"']);
      },
    },
    {
      name: 'an unknown key is reported, not ignored',
      overlay: {reorder: ['review', 'build']},
      check: m => {
        expect(ids(m.definition)).toEqual(['build', 'review']);
        expect(m.problems).toEqual(['overlay: unknown key "reorder"']);
      },
    },
    {
      name: 'a slot without a contract is reported',
      overlay: {add: [{stage: 'build', slot: {slot: 'x'}}]},
      check: m => {
        expect(m.definition).toEqual(DEF);
        expect(m.problems).toEqual(['overlay.add[0]: the slot needs a slot name and a contract']);
      },
    },
    {name: 'a non-object overlay is reported', overlay: [], check: m => expect(m.problems).toEqual(['overlay: must be an object'])},
  ];
  for (const c of cases) test(c.name, () => c.check(mergeOverlay(DEF, c.overlay)));

  test('the input definition is not mutated', () => {
    const before = JSON.stringify(DEF);
    mergeOverlay(DEF, {add: [{stage: 'build', slot: {slot: 'x', contract: 'y'}}], gates: {build: 'z'}, disable: ['review']});
    expect(JSON.stringify(DEF)).toBe(before);
  });
});
