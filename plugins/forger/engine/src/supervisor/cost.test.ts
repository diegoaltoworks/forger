import {describe, expect, test} from 'bun:test';

import {costUsd, DEFAULT_PRICES, mergePrices, parseTranscriptUsage, priceFor, sessionCostUsd, type PriceTable, type UsageRecord} from './cost';

const prices: PriceTable = {
  alpha: {input: 10, output: 50, cache_read: 1, cache_write: 12},
  beta: {input: 2, output: 4, cache_read: 0.5, cache_write: 3},
};
const usage = (model: string, i: number, o: number, r: number, w: number): UsageRecord => ({model, inputTokens: i, outputTokens: o, cacheReadTokens: r, cacheWriteTokens: w});

describe('costUsd', () => {
  const table: [string, UsageRecord[], number | null][] = [
    ['no records cost nothing', [], 0],
    ['input only', [usage('alpha', 1_000_000, 0, 0, 0)], 10],
    ['all four kinds of token', [usage('alpha', 1_000_000, 1_000_000, 1_000_000, 1_000_000)], 73],
    ['records of two models add', [usage('alpha', 500_000, 0, 0, 0), usage('beta', 0, 1_000_000, 0, 0)], 9],
    ['a model id contains its price key', [usage('x-beta-2', 1_000_000, 0, 0, 0)], 2],
    ['a model with no price is unknown', [usage('alpha', 1, 1, 1, 1), usage('gamma', 1, 1, 1, 1)], null],
  ];
  for (const [name, records, expected] of table) {
    test(name, () => expect(costUsd(records, prices)).toBe(expected));
  }
});

describe('priceFor', () => {
  test('an exact key beats a part match, the longest part beats a shorter one', () => {
    const t: PriceTable = {...prices, 'alpha-big': prices.beta};
    expect(priceFor('alpha', t)).toBe(t.alpha);
    expect(priceFor('alpha-big', t)).toBe(t['alpha-big']);
    expect(priceFor('my-alpha-big-1', t)).toBe(t['alpha-big']);
    expect(priceFor('nothing', t)).toBeNull();
  });
  test('the defaults price the model families', () => {
    for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) expect(priceFor(id, DEFAULT_PRICES)).not.toBeNull();
  });
});

describe('parseTranscriptUsage', () => {
  const line = (id: string, out: number) => JSON.stringify({message: {id, model: 'alpha', usage: {input_tokens: 1, output_tokens: out, cache_read_input_tokens: 2, cache_creation_input_tokens: 3}}});
  test('reads assistant usage and counts a repeated message once, by its last line', () => {
    const text = [line('m1', 5), JSON.stringify({type: 'user', message: {role: 'user', content: 'hi'}}), 'not json', line('m1', 9), line('m2', 1), ''].join('\n');
    expect(parseTranscriptUsage(text)).toEqual([usage('alpha', 1, 9, 2, 3), usage('alpha', 1, 1, 2, 3)]);
  });
});

describe('sessionCostUsd', () => {
  test('a missing transcript is unknown, not zero', () => {
    expect(sessionCostUsd(null, prices)).toBeNull();
  });
  test('an empty transcript is a known zero', () => {
    expect(sessionCostUsd('', prices)).toBe(0);
  });
  test('prices the transcript text', () => {
    const text = JSON.stringify({message: {id: 'm', model: 'beta', usage: {input_tokens: 1_000_000, output_tokens: 0}}});
    expect(sessionCostUsd(text, prices)).toBe(2);
  });
});

describe('mergePrices', () => {
  test('a project entry overrides a default and adds a model', () => {
    const own = {input: 1, output: 2, cache_read: 3, cache_write: 4};
    const merged = mergePrices(prices, {alpha: own, delta: own});
    expect(merged?.alpha).toEqual(own);
    expect(merged?.delta).toEqual(own);
    expect(merged?.beta).toEqual(prices.beta);
  });
  test('a malformed table is refused', () => {
    expect(mergePrices(prices, [])).toBeNull();
    expect(mergePrices(prices, {alpha: {input: 1}})).toBeNull();
    expect(mergePrices(prices, {alpha: {input: -1, output: 1, cache_read: 1, cache_write: 1}})).toBeNull();
  });
});
