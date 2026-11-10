import {expect, test} from 'bun:test';

import {run} from './main';

test('the arguments are joined into one name', () => {
  expect(run(['Ada', 'Lovelace'])).toBe('Hello, Ada Lovelace!');
});

test('no arguments greet the world', () => {
  expect(run([])).toBe('Hello, world!');
});
