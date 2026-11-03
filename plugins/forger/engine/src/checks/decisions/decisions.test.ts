import {describe, expect, test} from 'bun:test';

import {checkDecisions, diffDependencies, hasAdr, lineOf, manifestReaderFor, parseNameStatus, readPackageJson, type DependencyDiff} from './decisions';

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) => JSON.stringify({dependencies: deps, devDependencies: dev});
const none: DependencyDiff = {added: [], removed: [], bumped: []};

describe('diffDependencies', () => {
  const cases: Array<[string, string | null, string | null, DependencyDiff]> = [
    ['a dependency added', pkg({a: '1'}), pkg({a: '1', b: '2'}), {added: ['b'], removed: [], bumped: []}],
    ['a dev dependency added', pkg({}), pkg({}, {t: '1'}), {added: ['t'], removed: [], bumped: []}],
    ['a dependency removed', pkg({a: '1', b: '2'}), pkg({a: '1'}), {added: [], removed: ['b'], bumped: []}],
    ['a version bumped', pkg({a: '1'}), pkg({a: '2'}), {added: [], removed: [], bumped: ['a']}],
    ['nothing changed', pkg({a: '1'}), pkg({a: '1'}), none],
    ['a new manifest', null, pkg({a: '1'}), {added: ['a'], removed: [], bumped: []}],
    ['a manifest without dependencies', '{}', '{"name":"x"}', none],
  ];
  for (const [name, before, after, expected] of cases) {
    test(name, () => expect(diffDependencies(before, after, readPackageJson)).toEqual(expected));
  }

  test('a manifest that is not JSON is an error', () => expect(() => readPackageJson('{')).toThrow('not valid JSON'));
});

describe('checkDecisions', () => {
  const added = {path: 'package.json', diff: {...none, added: ['left-pad']}, lines: {'left-pad': 7}};
  const adr = {path: 'docs/adr/0004-left-pad.md', status: 'added' as const};
  const cases: Array<[string, Parameters<typeof checkDecisions>, string[]]> = [
    ['an added dependency with no ADR fails on its line', [[{path: 'package.json', status: 'modified'}], [added]], ['package.json:7:dependency-without-adr']],
    ['an added dependency with a new ADR passes', [[{path: 'package.json', status: 'modified'}, adr], [added]], []],
    ['a changed ADR counts', [[{path: 'package.json', status: 'modified'}, {...adr, status: 'modified'}], [added]], []],
    ['a deleted ADR does not count', [[{path: 'package.json', status: 'modified'}, {...adr, status: 'deleted'}], [added]], ['package.json:7:dependency-without-adr']],
    ['a non-markdown file under docs/adr does not count', [[{path: 'package.json', status: 'modified'}, {path: 'docs/adr/x.png', status: 'added'}], [added]], ['package.json:7:dependency-without-adr']],
    ['a bump needs no ADR', [[{path: 'package.json', status: 'modified'}], [{path: 'package.json', diff: {...none, bumped: ['a']}, lines: {}}]], []],
    ['a removal needs no ADR', [[{path: 'package.json', status: 'modified'}], [{path: 'package.json', diff: {...none, removed: ['a']}, lines: {}}]], []],
    ['a layer map change with no ADR fails', [[{path: '.forger/architecture.json', status: 'modified'}], []], ['.forger/architecture.json:1:layer-map-without-adr']],
    ['a layer map change with an ADR passes', [[{path: '.forger/architecture.json', status: 'modified'}, adr], []], []],
    ['both decisions without an ADR report both', [[{path: '.forger/architecture.json', status: 'modified'}], [added]], ['package.json:7:dependency-without-adr', '.forger/architecture.json:1:layer-map-without-adr']],
    ['an empty diff passes', [[], []], []],
  ];
  for (const [name, args, expected] of cases) {
    test(name, () => expect(checkDecisions(...args).map(f => `${f.file}:${f.line}:${f.rule}`)).toEqual(expected));
  }

  test('findings carry the opinion id', () => {
    expect(checkDecisions([], [added])[0].opinion).toBe('architecture.decisions-recorded');
  });
});

describe('helpers', () => {
  test('hasAdr only looks under docs/adr', () => expect(hasAdr([{path: 'docs/notes.md', status: 'added'}])).toBe(false));
  test('lineOf finds the quoted name, else line 1', () => {
    expect(lineOf('{\n  "dependencies": {\n    "zod": "1"\n  }\n}', 'zod')).toBe(3);
    expect(lineOf('{}', 'zod')).toBe(1);
  });
  test('manifestReaderFor matches by file name in any directory', () => {
    expect(manifestReaderFor('plugins/x/package.json')).toBe(readPackageJson);
    expect(manifestReaderFor('README.md')).toBeNull();
  });
  test('parseNameStatus reads added, modified and deleted', () => {
    expect(parseNameStatus('A\ta.ts\nM\tb.ts\nD\tc.ts\n')).toEqual([
      {path: 'a.ts', status: 'added'},
      {path: 'b.ts', status: 'modified'},
      {path: 'c.ts', status: 'deleted'},
    ]);
  });
  test('parseNameStatus rejects a line it cannot read', () => expect(() => parseNameStatus('garbage')).toThrow('name-status'));
});
