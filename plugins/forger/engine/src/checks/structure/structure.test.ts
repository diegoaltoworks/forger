import {describe, expect, test} from 'bun:test';

import {applyWaivers} from '../waivers';
import {classify, parseStructureBaseline, renderStructureBaseline, shrink, baselineGrew} from './baseline';
import {firstWord, isShim, observe, parseStructureConfig, toFinding} from './structure';

const config = (extra: Record<string, unknown> = {}) => parseStructureConfig(JSON.stringify(extra));
const files = (folder: string, n: number) => Array.from({length: n}, (_, i) => `${folder}/f${i}x.ts`);
const none = () => '';
const rules = (paths: string[], c = config(), read = none) => observe(paths, c, read);

describe('structure rules', () => {
  test('a folder over the limit with no baseline is a structure.folder-size finding', () => {
    const obs = rules(files('src/lib', 16));
    expect(obs.map(o => [o.rule, o.path, o.count])).toEqual([['structure.folder-size', 'src/lib', 16]]);
    const {fresh} = classify(obs, null);
    expect(fresh).toHaveLength(1);
    expect(toFinding(fresh[0]).opinion).toBe('structure.folder-size');
  });

  test('test files and ignored paths do not count toward folder size', () => {
    const paths = [...files('src/lib', 15), 'src/lib/a.test.ts', 'src/lib/b.spec.ts', 'src/lib/types.d.ts'];
    expect(rules(paths)).toEqual([]);
  });

  test('a new file in a folder already over the limit fails while the recorded count only warns', () => {
    const baseline = parseStructureBaseline(renderStructureBaseline(rules(files('src/lib', 16))));
    expect(classify(rules(files('src/lib', 16)), baseline)).toMatchObject({fresh: [], recorded: [{rule: 'structure.folder-size'}]});
    const grown = classify(rules(files('src/lib', 17)), baseline);
    expect(grown.fresh.map(o => o.rule)).toEqual(['structure.folder-size']);
  });

  test('four files sharing a prefix in one folder are a structure.prefix-cluster finding naming the prefix', () => {
    const obs = rules(['a/stop-a.ts', 'a/stop-b.ts', 'a/stop-c.ts', 'a/stop-d.ts', 'a/other.ts']);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({rule: 'structure.prefix-cluster', path: 'a', prefix: 'stop'});
    expect(obs[0].message).toContain('"stop"');
    expect(rules(['a/stop-a.ts', 'a/stop-b.ts', 'a/stop-c.ts'])).toEqual([]);
  });

  test('a camelCase prefix and a kebab-case prefix are both detected', () => {
    expect(firstWord('stopForm')).toBe('stop');
    expect(firstWord('stop-form')).toBe('stop');
    expect(firstWord('stop_form')).toBe('stop');
    const obs = rules(['a/stopForm.ts', 'a/stop-list.ts', 'a/stop_map.ts', 'a/Stop.ts']);
    expect(obs.map(o => o.prefix)).toEqual(['stop']);
  });

  test('a new cluster fails and a file joining a recorded cluster fails', () => {
    const four = ['a/stop-a.ts', 'a/stop-b.ts', 'a/stop-c.ts', 'a/stop-d.ts'];
    const baseline = parseStructureBaseline(renderStructureBaseline(rules(four)));
    expect(classify(rules(four), baseline).fresh).toEqual([]);
    expect(classify(rules([...four, 'a/stop-e.ts']), baseline).fresh).toHaveLength(1);
    expect(classify(rules([...four, 'a/trip-a.ts', 'a/trip-b.ts', 'a/trip-c.ts', 'a/trip-d.ts']), baseline).fresh.map(o => o.prefix)).toEqual(['trip']);
  });

  test('a file whose name starts with its folder\'s name is a structure.name-repeats-folder finding', () => {
    const obs = rules(['src/stops/stopForm.ts', 'src/trip/trip-header.tsx', 'src/trip/header.tsx', 'src/stops/stopwatch.ts', 'src/trip/index.ts']);
    expect(obs.filter(o => o.rule === 'structure.name-repeats-folder').map(o => o.path)).toEqual(['src/stops/stopForm.ts', 'src/trip/trip-header.tsx']);
  });

  test('a new top-level file in a frozen folder fails and a recorded one does not', () => {
    const c = config({frozen: ['src/lib']});
    const baseline = parseStructureBaseline(renderStructureBaseline(rules(['src/lib/a.ts'], c)));
    const out = classify(rules(['src/lib/a.ts', 'src/lib/b.ts', 'src/lib/deep/c.ts'], c), baseline);
    expect(out.fresh.map(o => o.path)).toEqual(['src/lib/b.ts']);
    expect(out.recorded.map(o => o.path)).toEqual(['src/lib/a.ts']);
  });

  test('a file that only re-exports is a structure.shim finding and an index file is not', () => {
    const reexport = `// moved\nexport * from './real';\nexport {a, b} from "./other";\nexport type {T} from './t';\n`;
    const read = () => reexport;
    expect(rules(['src/old.ts'], config(), read).map(o => o.rule)).toEqual(['structure.shim']);
    expect(rules(['src/index.ts'], config(), read)).toEqual([]);
    expect(isShim(`export * from './x';\nexport const y = 1;\n`)).toBe(false);
    expect(isShim('')).toBe(false);
  });

  test('a waiver for a structure rule and path silences that finding', () => {
    const findings = rules(files('src/lib', 16)).map(toFinding);
    const waiver = {opinion: 'structure.folder-size', path: 'src/lib', reason: 'r', approved_by: 'owner'};
    expect(applyWaivers(findings, [waiver]).violations).toEqual([]);
    expect(applyWaivers(findings, [{...waiver, path: 'other'}]).violations).toHaveLength(1);
  });
});

describe('structure config', () => {
  test('an unknown key in structure.json is an error naming the key', () => {
    expect(() => parseStructureConfig('{"folder_limt": 3}')).toThrow('folder_limt');
  });

  test('a wrong type is an error naming the key', () => {
    expect(() => parseStructureConfig('{"folder_limit": "x"}')).toThrow('folder_limit');
    expect(() => parseStructureConfig('{"frozen": [1]}')).toThrow('frozen');
  });
});

describe('structure baseline', () => {
  test('check structure --update removes entries that no longer hold and adds none', () => {
    const before = rules([...files('src/lib', 16), 'src/x/old.ts'], config({frozen: ['src/x']}));
    const baseline = parseStructureBaseline(renderStructureBaseline(before));
    const now = rules([...files('src/lib', 16).slice(0, 15), 'src/y/new.ts', 'src/y/f.ts'], config({frozen: ['src/x', 'src/y']}));
    const next = shrink(now, baseline);
    expect(next.entries).toEqual([]);
    const still = shrink(rules(files('src/lib', 17)), baseline);
    expect(still.entries).toEqual([{rule: 'structure.folder-size', path: 'src/lib', count: 16}]);
  });

  test('a baseline that gained entries since the merge-base is a finding on the baseline file', () => {
    const small = parseStructureBaseline(renderStructureBaseline(rules(files('src/lib', 16))));
    const bigger = parseStructureBaseline(renderStructureBaseline(rules(files('src/lib', 17))));
    expect(baselineGrew(small, small)).toEqual([]);
    expect(baselineGrew(bigger, small)).toEqual([]);
    expect(baselineGrew(small, bigger).map(f => f.file)).toEqual(['.forger/structure-baseline.json']);
    expect(baselineGrew({entries: []}, small)).toHaveLength(1);
  });

  test('a malformed baseline is an error', () => {
    expect(() => parseStructureBaseline('{}')).toThrow('entries');
    expect(() => parseStructureBaseline('{"entries":[{"rule":"nope","path":"a"}]}')).toThrow('rule');
  });
});
