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
});
