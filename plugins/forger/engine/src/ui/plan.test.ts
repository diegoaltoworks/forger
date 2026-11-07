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

describe('planCaptures into another folder', () => {
  test('lands the files in the given folder', () => {
    const config = parseUiConfig(JSON.stringify({paths: ['a'], start: 's', routes: ['/t/'], viewports: [{name: 'phone', width: 1, height: 1}], themes: ['light']}));
    expect(planCaptures(config, 'docs/design/t/').map(c => c.file)).toEqual(['docs/design/t/t-phone-light.png']);
  });

  test('a route with a query string is planned under its own file', () => {
    const c = parseUiConfig(JSON.stringify({paths: ['a'], start: 's', routes: ['/list?filter=open'], viewports: [{name: 'phone', width: 1, height: 1}], themes: ['light']}));
    expect(planCaptures(c).map(p => [p.url, p.file])).toEqual([['http://localhost:3000/list?filter=open', 'docs/screenshots/list-filter-open-phone-light.png']]);
  });

  test('a state is planned per viewport and theme, named by the state, with its steps', () => {
    const c = parseUiConfig(JSON.stringify({
      paths: ['a'], start: 's', routes: ['/'], viewports: [{name: 'phone', width: 1, height: 2}], themes: ['light', 'dark'],
      states: [{name: 'filtered', route: '/list?f=1', steps: [{click: '#f'}]}],
    }));
    const states = planCaptures(c).filter(p => p.state === 'filtered');
    expect(states.map(p => p.file)).toEqual(['docs/screenshots/filtered-phone-light.png', 'docs/screenshots/filtered-phone-dark.png']);
    expect(states[0]).toMatchObject({url: 'http://localhost:3000/list?f=1', steps: [{click: '#f'}]});
  });

  test('a state that would overwrite a route image is refused', () => {
    const c = parseUiConfig(JSON.stringify({paths: ['a'], start: 's', routes: ['/about'], states: [{name: 'about'}]}));
    expect(() => planCaptures(c)).toThrow('both write');
  });
});

describe('planCaptures with locales', () => {
  const config = parseUiConfig(JSON.stringify({
    paths: ['a'], start: 's', routes: ['/about'], viewports: [{name: 'phone', width: 1, height: 2}], themes: ['light'],
    locales: [{code: 'en', dir: 'ltr', param: 'lang'}, {code: 'ar', dir: 'rtl', param: 'lang'}],
  }));

  test('a ui.json with two locales captures each screen in both and names the files by locale', () => {
    const plan = planCaptures(config);
    expect(plan.map(c => c.file)).toEqual(['docs/screenshots/about-en-phone-light.png', 'docs/screenshots/about-ar-phone-light.png']);
    expect(plan.map(c => c.url)).toEqual(['http://localhost:3000/about?lang=en', 'http://localhost:3000/about?lang=ar']);
  });

  test('an rtl locale capture runs the page with dir rtl', () => {
    const plan = planCaptures(config);
    expect(plan.map(c => [c.locale, c.dir])).toEqual([['en', 'ltr'], ['ar', 'rtl']]);
  });

  test('a locale switched by steps runs them before the state steps and appends the param with &', () => {
    const c = parseUiConfig(JSON.stringify({
      paths: ['a'], start: 's', routes: ['/'], viewports: [{name: 'phone', width: 1, height: 2}], themes: ['light'],
      locales: [{code: 'ar', dir: 'rtl', steps: [{click: '#ar'}]}],
      states: [{name: 'open', route: '/l?x=1', steps: [{click: '#o'}]}],
    }));
    const open = planCaptures(c).find(p => p.state === 'open');
    expect(open?.steps).toEqual([{click: '#ar'}, {click: '#o'}]);
    const withParam = parseUiConfig(JSON.stringify({paths: ['a'], start: 's', routes: ['/l?x=1'], locales: [{code: 'ar', dir: 'rtl', param: 'lang'}]}));
    expect(planCaptures(withParam)[0].url).toBe('http://localhost:3000/l?x=1&lang=ar');
  });

  test('a locale with no way to switch the app, a bad dir or a repeated code is refused', () => {
    const bad = (locales: unknown) => () => parseUiConfig(JSON.stringify({paths: ['a'], start: 's', locales}));
    expect(bad([{code: 'ar', dir: 'rtl'}])).toThrow('needs a param or steps');
    expect(bad([{code: 'ar', dir: 'up', param: 'l'}])).toThrow('ltr or rtl');
    expect(bad([{code: 'ar', dir: 'rtl', param: 'l'}, {code: 'AR', dir: 'rtl', param: 'l'}])).toThrow('unique');
  });
});
