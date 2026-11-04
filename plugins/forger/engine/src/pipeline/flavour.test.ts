import {describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {checkPin, flavourMapping, newerFlavour, parseFlavour, parseFlavourRef} from './flavour';
import {listFlavours, loadDefinition, loadFlavour, shippedFlavour} from './load';
import {resolvePipeline, type PlannedSlot} from './resolve';
import {NO_TICKET, type Flavour} from './types';

const PLUGIN_ROOT = join(import.meta.dir, '..', '..', '..');

const MIXED: Flavour = parseFlavour(
  {
    name: 'mixed',
    version: 1,
    description: 'The strongest fit per slot.',
    slots: {
      interview: [{skill: 'mattpocock-skills:grilling'}],
      glossary: [{skill: 'mattpocock-skills:domain-modeling'}],
      test_first: [{skill: 'mattpocock-skills:tdd'}],
      review: [
        {skill: 'agent-skills:code-review-and-quality', when: {labels_none: ['ui']}},
        {file: 'pstack/skills/interrogate/SKILL.md', when: {labels_any: ['ui']}},
      ],
      risk: [{file: 'pstack/skills/blast-radius/SKILL.md', when: {paths_any: ['**/migrate/**', '**/state*']}}],
      diagnose: [{skill: 'mattpocock-skills:diagnosing-bugs'}],
      pr_body: [{skill: 'mattpocock-skills:pr'}],
    },
  },
  'mixed.json'
);

const DEFAULT = shippedFlavour(PLUGIN_ROOT, 'default') as Flavour;
const INSTALLED = ['mattpocock-skills:grilling', 'mattpocock-skills:domain-modeling', 'mattpocock-skills:tdd', 'mattpocock-skills:diagnosing-bugs', 'mattpocock-skills:pr', 'agent-skills:code-review-and-quality'];
const definition = loadDefinition(PLUGIN_ROOT);

function plan(flavour: Flavour, overrides: Parameters<typeof resolvePipeline>[3], ticket: Parameters<typeof resolvePipeline>[5], opts: {pstack: boolean; installed?: string[]} = {pstack: false}) {
  const env = {roots: ['/c'], exists: (p: string) => opts.pstack && p.startsWith('/c/pstack')};
  const out = resolvePipeline(definition, undefined, flavour, overrides, opts.installed ?? INSTALLED, ticket, env);
  const slots = new Map<string, PlannedSlot>();
  for (const st of out.stages) for (const s of st.slots) slots.set(s.slot, s);
  return {out, slots};
}

const A = {...NO_TICKET, id: 'issue-201', labels: ['bug'], paths: ['engine/src/loop/merge.ts']};
const B = {...NO_TICKET, id: 'issue-202', labels: ['ui'], paths: ['app/screens/settings/']};

describe('the ADR 0016 section 5 plans for the mixed flavour', () => {
  test('ticket A: the backend fix', () => {
    const {out, slots} = plan(MIXED, {}, A);
    expect(out.flavour).toBe('mixed@1');
    expect(slots.get('test_first')).toMatchObject({invoke: 'skill', target: 'mattpocock-skills:tdd', reason: 'mixed candidate 1'});
    expect(slots.get('diagnose')).toMatchObject({invoke: 'skill', target: 'mattpocock-skills:diagnosing-bugs', on: 'gate_red', reason: 'mixed candidate 1'});
    expect(slots.get('review')).toMatchObject({invoke: 'skill', target: 'agent-skills:code-review-and-quality', reason: 'mixed candidate 1: labels_none [ui] holds'});
    expect(slots.get('risk')).toMatchObject({invoke: 'builtin', reason: 'builtin: mixed candidate 1 paths_any did not match engine/src/loop/merge.ts'});
    expect(slots.get('pr_body')).toMatchObject({invoke: 'skill', target: 'mattpocock-skills:pr', reason: 'mixed candidate 1'});
    expect(slots.get('merge_conflicts')).toMatchObject({invoke: 'builtin', on: 'rebase_conflict', reason: 'builtin: flavour maps nothing'});
    expect(slots.has('design')).toBe(false);
  });

  test('ticket B: the UI feature with pstack not installed', () => {
    const {slots} = plan(MIXED, {}, B);
    expect(slots.get('design')).toMatchObject({invoke: 'builtin', reason: 'builtin: flavour maps nothing; when labels_any [ui] holds'});
    expect(slots.get('review')).toMatchObject({
      invoke: 'builtin',
      reason: 'builtin: mixed candidate 1 labels_none [ui] failed; candidate 2 pstack/skills/interrogate/SKILL.md not installed',
    });
    expect(slots.get('risk')).toMatchObject({invoke: 'builtin', reason: 'builtin: mixed candidate 1 paths_any did not match app/screens/settings/'});
    expect(slots.get('pr_body')).toMatchObject({invoke: 'skill', target: 'mattpocock-skills:pr'});
  });

  test('ticket B with pstack installed: the second candidate wins', () => {
    const {slots} = plan(MIXED, {}, B, {pstack: true});
    expect(slots.get('review')).toMatchObject({invoke: 'file', target: join('/c', 'pstack/skills/interrogate/SKILL.md'), reason: 'mixed candidate 2: labels_any [ui] holds'});
  });

  test('the default flavour plans the built-in everywhere', () => {
    for (const t of [A, B]) {
      const {out, slots} = plan(DEFAULT, {}, t);
      expect(out.flavour).toBe('default@1');
      for (const s of slots.values()) expect(s).toMatchObject({invoke: 'builtin', reason: expect.stringContaining('builtin: flavour default')});
    }
    expect(plan(DEFAULT, {}, B).slots.get('design')?.reason).toBe('builtin: flavour default; when labels_any [ui] holds');
  });
});

describe('candidate order', () => {
  const two = (a: object, b: object): Flavour => ({name: 'f', version: 1, description: '', slots: {review: [a, b]}});
  const review = (f: Flavour, installed: string[], t = NO_TICKET) => plan(f, {}, t, {pstack: false, installed}).slots.get('review');

  test('the first candidate wins when both would', () => {
    expect(review(two({skill: 'a:x'}, {skill: 'b:y'}), ['a:x', 'b:y'])).toMatchObject({target: 'a:x', reason: 'f candidate 1'});
  });
  test('a failing condition hands the slot to the next candidate', () => {
    const f = two({skill: 'a:x', when: {labels_any: ['ui']}}, {skill: 'b:y'});
    expect(review(f, ['a:x', 'b:y'])).toMatchObject({target: 'b:y', reason: 'f candidate 2'});
  });
  test('a candidate that is not installed hands the slot to the next', () => {
    expect(review(two({skill: 'a:x'}, {skill: 'b:y'}), ['b:y'])).toMatchObject({target: 'b:y', reason: 'f candidate 2'});
  });
  test('when all fail the built-in wins and each loss is named', () => {
    const r = review(two({skill: 'a:x'}, {skill: 'b:y', when: {packs_all: ['base']}}), []);
    expect(r).toMatchObject({invoke: 'builtin', reason: 'builtin: f candidate 1 a:x not installed; candidate 2 packs_all [base] failed'});
  });
  test('every key of a condition must hold', () => {
    const f = two({skill: 'a:x', when: {labels_any: ['ui'], packs_all: ['base']}}, {skill: 'b:y'});
    expect(review(f, ['a:x', 'b:y'], {...NO_TICKET, labels: ['ui'], packs: []})?.target).toBe('b:y');
    expect(review(f, ['a:x', 'b:y'], {...NO_TICKET, labels: ['ui'], packs: ['base']})?.target).toBe('a:x');
  });
});

describe('the skills map', () => {
  test('wins over the flavour for the slots it names, and only those', () => {
    const {slots} = plan(MIXED, {test_first: 'mine:tdd'}, A, {pstack: false, installed: [...INSTALLED, 'mine:tdd']});
    expect(slots.get('test_first')).toMatchObject({target: 'mine:tdd', reason: 'skills map'});
    expect(slots.get('diagnose')).toMatchObject({target: 'mattpocock-skills:diagnosing-bugs'});
  });
  test('an override that is not installed does not fall back to the flavour', () => {
    const {slots} = plan(MIXED, {test_first: 'mine:tdd'}, A);
    expect(slots.get('test_first')).toMatchObject({invoke: 'builtin', reason: 'builtin: skills map names mine:tdd, not installed'});
  });
  test('a config with only a skills map resolves as the default flavour with the overrides', () => {
    const {slots} = plan(DEFAULT, {review: 'mine:r'}, A, {pstack: false, installed: ['mine:r']});
    expect(slots.get('review')).toMatchObject({invoke: 'skill', target: 'mine:r', reason: 'skills map'});
    expect(slots.get('test_first')?.invoke).toBe('builtin');
  });
});

describe('flavourMapping', () => {
  test('is the installed, unconditioned choice for a ticket with nothing', () => {
    expect(flavourMapping(MIXED, NO_TICKET, INSTALLED, {roots: [], exists: () => false})).toEqual({
      interview: 'mattpocock-skills:grilling',
      glossary: 'mattpocock-skills:domain-modeling',
      test_first: 'mattpocock-skills:tdd',
      review: 'agent-skills:code-review-and-quality',
      diagnose: 'mattpocock-skills:diagnosing-bugs',
      pr_body: 'mattpocock-skills:pr',
    });
  });
  test('the default maps nothing', () => {
    expect(flavourMapping(DEFAULT, NO_TICKET, INSTALLED)).toEqual({});
  });
});

describe('parsing', () => {
  const ok = {name: 'n', version: 1, description: 'd', slots: {review: [{skill: 'a:b'}]}};
  test.each([
    [{...ok, name: 'a b'}, 'name'],
    [{...ok, version: 0}, 'version'],
    [{...ok, slots: []}, 'slots'],
    [{...ok, slots: {review: [{skill: 'a', file: 'b'}]}}, 'exactly one of skill or file'],
    [{...ok, slots: {review: [{}]}}, 'exactly one of skill or file'],
    [{...ok, slots: {review: [{skill: 'a', when: {labels: ['x']}}]}}, 'unknown condition "labels"'],
    [{...ok, slots: {review: [{skill: 'a', when: {labels_any: 'ui'}}]}}, 'must be a list'],
  ])('rejects %j', (data, message) => {
    expect(() => parseFlavour(data, 'f.json')).toThrow(message);
  });
  test('reads a ref with and without a version', () => {
    expect(parseFlavourRef('mixed@2')).toEqual({name: 'mixed', version: 2});
    expect(parseFlavourRef('mixed')).toEqual({name: 'mixed', version: null});
    expect(() => parseFlavourRef('mixed@x')).toThrow('flavour must be');
  });
  test('a pin must match the version found, and a newer shipped version is reported', () => {
    expect(checkPin({name: 'n', version: 1}, {...ok, slots: {}, version: 2})).toContain('pins n@1');
    expect(checkPin({name: 'n', version: null}, {...ok, slots: {}, version: 2})).toBeNull();
    expect(newerFlavour({name: 'n', version: 1}, {name: 'n', version: 2})).toBe(2);
    expect(newerFlavour({name: 'n', version: 2}, {name: 'n', version: 2})).toBeNull();
    expect(newerFlavour({name: 'n', version: null}, {name: 'n', version: 2})).toBeNull();
  });
});

describe('loading', () => {
  test('the shipped flavours parse and map only slots forger knows', () => {
    const shipped = listFlavours(join(PLUGIN_ROOT, 'flavours'));
    expect(shipped.map(f => f.name)).toEqual(expect.arrayContaining(['default', 'mattpocock-skills']));
    expect(plan(shipped.find(f => f.name === 'mattpocock-skills') as Flavour, {}, NO_TICKET).out.problems).toEqual([]);
  });
  test('a project flavour beats a shipped one of the same name, and a wrong pin is an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forger-flavour-'));
    try {
      mkdirSync(join(dir, 'flavours'));
      writeFileSync(join(dir, 'flavours', 'default.json'), JSON.stringify({name: 'default', version: 7, description: 'mine', slots: {}}));
      expect(loadFlavour(PLUGIN_ROOT, dir, 'default@7').description).toBe('mine');
      expect(() => loadFlavour(PLUGIN_ROOT, dir, 'default@1')).toThrow('pins default@1');
      expect(() => loadFlavour(PLUGIN_ROOT, dir, 'nope')).toThrow('no flavour named "nope"');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
