import {describe, expect, test} from 'bun:test';

import {captureFile, planCaptures, routeSlug} from './plan';
import {parseUiConfig} from './ui-config';

describe('routeSlug', () => {
  const table: Array<[string, string]> = [
    ['/', 'index'],
    ['/about', 'about'],
    ['/a/b', 'a-b'],
    ['/Accounts/42/', 'accounts-42'],
    ['/search?q=a b', 'search-q-a-b'],
  ];
  for (const [route, slug] of table) test(`${route} is ${slug}`, () => expect(routeSlug(route)).toBe(slug));
});

describe('planCaptures', () => {
  const config = parseUiConfig(JSON.stringify({paths: ['src/**'], start: 's', url: 'http://localhost:4000', routes: ['/', '/about']}));

  test('covers every route x viewport x theme', () => {
    expect(planCaptures(config).map(c => c.file)).toEqual([
      'docs/screenshots/index-phone-light.png',
      'docs/screenshots/index-phone-dark.png',
      'docs/screenshots/index-desktop-light.png',
      'docs/screenshots/index-desktop-dark.png',
      'docs/screenshots/about-phone-light.png',
      'docs/screenshots/about-phone-dark.png',
      'docs/screenshots/about-desktop-light.png',
      'docs/screenshots/about-desktop-dark.png',
    ]);
  });

  test('carries the url and the size of each capture', () => {
    const c = planCaptures(config)[2];
    expect(c).toMatchObject({url: 'http://localhost:4000/', width: 1280, height: 800, theme: 'light', viewport: 'desktop'});
  });

  test('the same config always plans the same files', () => {
    expect(planCaptures(config)).toEqual(planCaptures(config));
  });

  test('two routes that would write one file are refused', () => {
    const clash = parseUiConfig(JSON.stringify({paths: ['a'], start: 's', routes: ['/a/b', '/a-b']}));
    expect(() => planCaptures(clash)).toThrow('both write');
  });

  test('names a single file', () => {
    expect(captureFile('/x', 'phone', 'dark')).toBe('docs/screenshots/x-phone-dark.png');
  });
});
