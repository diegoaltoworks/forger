import {describe, expect, test} from 'bun:test';

import {DEFAULT_THEMES, DEFAULT_VIEWPORTS, UiConfigError, parseUiConfig} from './ui-config';

const base = {paths: ['src/**'], start: 'bun run dev'};

describe('parseUiConfig', () => {
  test('applies the defaults: a phone and a desktop, light and dark, the root route', () => {
    const c = parseUiConfig(JSON.stringify(base));
    expect(c.viewports).toEqual(DEFAULT_VIEWPORTS);
    expect(c.themes).toEqual(DEFAULT_THEMES);
    expect(c.routes).toEqual(['/']);
    expect(c.url).toBe('http://localhost:3000');
  });

  test('trims a trailing slash from the url', () => {
    expect(parseUiConfig(JSON.stringify({...base, url: 'http://localhost:5173/'})).url).toBe('http://localhost:5173');
  });

  const bad: Array<[string, unknown, string]> = [
    ['not an object', [], 'must be an object'],
    ['no paths', {start: 'x'}, '"paths"'],
    ['empty paths', {...base, paths: []}, '"paths"'],
    ['no start', {paths: ['a']}, '"start"'],
    ['route without a slash', {...base, routes: ['about']}, 'must start with "/"'],
    ['viewport name with spaces', {...base, viewports: [{name: 'Big Phone', width: 1, height: 1}]}, 'lowercase words'],
    ['viewport without a size', {...base, viewports: [{name: 'a', width: 0, height: 1}]}, 'positive integer'],
    ['duplicate viewport names', {...base, viewports: [{name: 'a', width: 1, height: 1}, {name: 'a', width: 2, height: 2}]}, 'unique'],
    ['empty viewports', {...base, viewports: []}, 'non-empty'],
    ['unknown theme', {...base, themes: ['sepia']}, 'light or dark'],
    ['duplicate themes', {...base, themes: ['dark', 'dark']}, 'unique'],
    ['url without a scheme', {...base, url: 'localhost:3000'}, 'http'],
    ['timeout zero', {...base, ready_timeout: 0}, 'ready_timeout'],
  ];
  for (const [name, value, message] of bad) {
    test(`rejects ${name}`, () => {
      expect(() => parseUiConfig(JSON.stringify(value))).toThrow(UiConfigError);
      expect(() => parseUiConfig(JSON.stringify(value))).toThrow(message);
    });
  }

  test('rejects text that is not JSON', () => {
    expect(() => parseUiConfig('{')).toThrow('not valid JSON');
  });

  describe('captures', () => {
    const cap = {name: 'play', steps: [{wait: '#start'}, {click: '#start'}, {key: 'ArrowRight'}, {tap: '#b'}, {pause: 500}]};
    const parse = (c: unknown) => parseUiConfig(JSON.stringify({...base, captures: c}));

    test('a file without captures has none', () => expect(parseUiConfig(JSON.stringify(base)).captures).toEqual([]));

    test('fills the route, the first viewport and the default length', () => {
      expect(parse([cap]).captures).toEqual([{name: 'play', route: '/', viewport: 'phone', steps: cap.steps, max_seconds: 15}]);
    });

    test('keeps what is declared', () => {
      const [c] = parse([{...cap, route: '/game', viewport: 'desktop', max_seconds: 30}]).captures;
      expect(c).toMatchObject({route: '/game', viewport: 'desktop', max_seconds: 30});
    });

    const bad: Array<[string, unknown, string]> = [
      ['not a list', {}, '"captures" must be a list'],
      ['a bad name', [{...cap, name: 'Play it'}], 'lowercase words'],
      ['a duplicate name', [cap, cap], 'names must be unique'],
      ['a route without a slash', [{...cap, route: 'game'}], 'must start with "/"'],
      ['an unknown viewport', [{...cap, viewport: 'tv'}], 'not one of the declared viewports'],
      ['no steps', [{...cap, steps: []}], 'non-empty list'],
      ['an unknown step', [{...cap, steps: [{hover: '#a'}]}], 'exactly one of'],
      ['a step with two kinds', [{...cap, steps: [{wait: '#a', click: '#a'}]}], 'exactly one of'],
      ['an empty selector', [{...cap, steps: [{click: ' '}]}], 'non-empty string'],
      ['a bad pause', [{...cap, steps: [{pause: 0}]}], 'positive integer of milliseconds'],
      ['a bad length', [{...cap, max_seconds: 0}], 'max_seconds'],
      ['pauses longer than the maximum', [{...cap, max_seconds: 1, steps: [{pause: 1500}]}], 'more than its max_seconds'],
    ];
    for (const [name, value, message] of bad) {
      test(`rejects ${name}`, () => expect(() => parse(value)).toThrow(message));
    }
  });
});
