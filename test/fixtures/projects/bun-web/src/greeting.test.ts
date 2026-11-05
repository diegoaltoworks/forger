import {expect, test} from 'bun:test';

import {greeting} from './greeting';

test('greets by name', () => {
  expect(greeting('Ada')).toBe('Hello, Ada');
});
