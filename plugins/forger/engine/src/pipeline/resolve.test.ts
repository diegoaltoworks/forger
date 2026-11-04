import {describe, expect, test} from 'bun:test';
import {join} from 'path';

import {loadDefinition} from './load';
import {resolvePipeline} from './resolve';
import {NO_TICKET, type Definition, type Flavour} from './types';

const NONE: Flavour = {name: 'default', version: 1, description: 'd', slots: {}};

const DEF: Definition = {
  version: 1,
  stages: [
    {
      id: 'build',
      command: 'auto-ticket',
      inputs: ['ticket'],
      slots: [
        {slot: 'design', contract: 'wireframe', when: {labels_any: ['ui']}},
        {slot: 'test_first', contract: 'tests_written'},
        {slot: 'diagnose', contract: 'diagnosis', on: 'gate_red'},
        {slot: 'risk', contract: 'risk_report', when: {paths_any: ['**/migrate/**'], labels_none: ['docs']}},
      ],
      gate: 'gates',
    },
  ],
};

const ticket = (labels: string[], paths: string[] = []) => ({...NO_TICKET, id: 'issue-1', labels, paths});
const slotOf = (plan: ReturnType<typeof resolvePipeline>, name: string) => plan.stages[0]?.slots.find(s => s.slot === name);

describe('resolvePipeline', () => {
  test('a when that matches the ticket labels keeps the slot', () => {
    const plan = resolvePipeline(DEF, undefined, NONE, {}, [], ticket(['ui']));
    expect(slotOf(plan, 'design')?.reason).toBe('builtin: flavour default; when labels_any [ui] holds');
    expect(plan.stages[0]?.skipped.map(s => s.slot)).toEqual(['risk']);
  });

  test('a when that does not match skips the slot with the reason', () => {
    const plan = resolvePipeline(DEF, undefined, NONE, {}, [], ticket(['bug']));
    expect(slotOf(plan, 'design')).toBeUndefined();
    expect(plan.stages[0]?.skipped).toContainEqual({slot: 'design', reason: 'when labels_any [ui] does not hold'});
  });

  test('labels_none and paths_any are read from the ticket', () => {
    const hit = resolvePipeline(DEF, undefined, NONE, {}, [], ticket([], ['src/migrate/x.ts']));
    expect(slotOf(hit, 'risk')).toBeDefined();
    const blocked = resolvePipeline(DEF, undefined, NONE, {}, [], ticket(['docs'], ['src/migrate/x.ts']));
    expect(blocked.stages[0]?.skipped).toContainEqual({slot: 'risk', reason: 'when labels_none [docs] does not hold'});
    const noPath = resolvePipeline(DEF, undefined, NONE, {}, [], ticket([], ['src/other.ts']));
    expect(noPath.stages[0]?.skipped).toContainEqual({slot: 'risk', reason: 'when paths_any [**/migrate/**] does not hold'});
  });

  test('an on slot is listed with its event', () => {
    const d = slotOf(resolvePipeline(DEF, undefined, NONE, {}, [], NO_TICKET), 'diagnose');
    expect(d).toMatchObject({on: 'gate_red', invoke: 'builtin', reason: 'builtin: flavour default', contract: 'diagnosis'});
    expect(d?.target).toBe('Reproduce the red gate, form one hypothesis, test it');
  });

  test('a mapped installed skill is chosen, with the skills map as the reason', () => {
    const t = slotOf(resolvePipeline(DEF, undefined, NONE, {test_first: 'tdd:run'}, ['tdd:run'], NO_TICKET), 'test_first');
    expect(t).toMatchObject({invoke: 'skill', target: 'tdd:run', reason: 'skills map'});
  });

  test('a mapped missing skill falls back to the built-in and says why', () => {
    const t = slotOf(resolvePipeline(DEF, undefined, NONE, {test_first: 'tdd:run'}, [], NO_TICKET), 'test_first');
    expect(t).toMatchObject({invoke: 'builtin', target: 'Write the failing test, make it pass, then refactor', reason: 'builtin: skills map names tdd:run, not installed'});
  });

  test('a mapped file that exists is a file slot', () => {
    const t = slotOf(resolvePipeline(DEF, undefined, NONE, {test_first: {file: 'a/SKILL.md'}}, [], NO_TICKET, {roots: ['/r'], exists: () => true}), 'test_first');
    expect(t).toMatchObject({invoke: 'file', target: join('/r', 'a/SKILL.md'), reason: 'skills map'});
  });

  test('an overlay slot with a name forger has no line for resolves through the mapping', () => {
    const overlay = {add: [{stage: 'build', slot: {slot: 'review_security', contract: 'review_findings'}}]};
    const plan = resolvePipeline(DEF, overlay, NONE, {review_security: 'sec:audit'}, ['sec:audit'], NO_TICKET);
    expect(slotOf(plan, 'review_security')).toMatchObject({invoke: 'skill', target: 'sec:audit'});
    const bare = resolvePipeline(DEF, overlay, NONE, {}, [], NO_TICKET);
    expect(slotOf(bare, 'review_security')).toMatchObject({invoke: 'builtin', target: null});
  });

  test('overlay problems and disabled stages travel with the plan', () => {
    const plan = resolvePipeline(DEF, {disable: ['build', 'nope']}, NONE, {}, [], NO_TICKET);
    expect(plan.stages).toEqual([]);
    expect(plan.disabled).toEqual(['build']);
    expect(plan.problems).toEqual(['overlay.disable: unknown stage "nope"']);
  });

  test('the shipped default resolves every stage, with and without labels', () => {
    const def = loadDefinition(join(import.meta.dir, '..', '..', '..'));
    const ids = def.stages.map(s => s.id);
    for (const t of [NO_TICKET, ticket(['ui'])]) expect(resolvePipeline(def, undefined, NONE, {}, [], t).stages.map(s => s.id)).toEqual(ids);
    const ui = resolvePipeline(def, undefined, NONE, {}, [], ticket(['ui']));
    expect(ui.stages[0]?.slots.map(s => s.slot)).toContain('design');
    expect(resolvePipeline(def, undefined, NONE, {}, [], NO_TICKET).stages[0]?.slots.map(s => s.slot)).not.toContain('design');
  });
});
