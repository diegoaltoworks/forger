import {describe, expect, test} from 'bun:test';

import {chooseStarter, withStarterPacks, type StarterManifest} from './choose';

const bun: StarterManifest = {name: 'bun-typescript', description: 'd', gates: 'g', packs: ['base', 'testing']};
const other: StarterManifest = {...bun, name: 'other'};

describe('chooseStarter', () => {
  test('a repository with no source gets the default starter', () => {
    expect(chooseStarter({hasSource: false, noStarter: false, available: [bun, other]})).toEqual({kind: 'use', starter: bun});
  });
  test('a repository with source files gets none', () => {
    expect(chooseStarter({hasSource: true, noStarter: false, available: [bun]})).toEqual({kind: 'none'});
  });
  test('--no-starter gets none', () => {
    expect(chooseStarter({hasSource: false, noStarter: true, wanted: 'bun-typescript', available: [bun]})).toEqual({kind: 'none'});
  });
  test('a name picks that starter', () => {
    expect(chooseStarter({hasSource: false, noStarter: false, wanted: 'other', available: [bun, other]})).toEqual({kind: 'use', starter: other});
  });
  test('an unknown starter name is an error that lists the names', () => {
    expect(() => chooseStarter({hasSource: false, noStarter: false, wanted: 'nope', available: [bun, other]})).toThrow('Starters: bun-typescript, other');
  });
  test('no starters shipped means none', () => {
    expect(chooseStarter({hasSource: false, noStarter: false, available: []})).toEqual({kind: 'none'});
  });
});

describe('withStarterPacks', () => {
  test('adds the starter packs once', () => {
    expect(withStarterPacks(['base', 'x'], bun)).toEqual(['base', 'x', 'testing']);
  });
});
