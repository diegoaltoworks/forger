import {describe, expect, test} from 'bun:test';

import {greet} from './greet';

describe('greet', () => {
  test('greets the name it is given', () => {
    expect(greet('Ada')).toBe('Hello, Ada!');
  });
  test('a blank name greets the world', () => {
    expect(greet('  ')).toBe('Hello, world!');
  });
});
