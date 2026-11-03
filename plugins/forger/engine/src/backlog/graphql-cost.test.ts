import {describe, expect, test} from 'bun:test';

import {graphqlCost, graphqlRequests} from './graphql-cost';

/**
 * Costs recorded from GitHub with `rateLimit(dryRun: true) { cost }`, so the
 * formula is checked against the platform, not against itself.
 */
const CLOSER = 'timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent { closer { __typename } } } }';
const measured: Array<[string, number]> = [
  [
    `issues(first: 100, labels: [$label], states: [OPEN, CLOSED]) { nodes { number labels(first: 50) { nodes { name } } ${CLOSER} blockedBy(first: 50) { nodes { number labels(first: 50) { nodes { name } } ${CLOSER} } } } }`,
    103,
  ],
  ['issues(first: 100, labels: [$label]) { nodes { number labels(first: 50) { nodes { name } } } }', 1],
  [`issues(first: 100, labels: [$label]) { nodes { number labels(first: 50) { nodes { name } } ${CLOSER} } }`, 2],
  ['issues(first: 100, labels: [$label]) { nodes { number blockedBy(first: 10) { nodes { number labels(first: 20) { nodes { name } } } } } }', 11],
  ['issues(first: 50, labels: [$label]) { nodes { number blockedBy(first: 10) { nodes { number labels(first: 20) { nodes { name } } } } } }', 6],
  ['issues(first: 10, labels: [$label]) { nodes { number } }', 1],
];

function wrap(body: string): string {
  return `query($owner: String!, $repo: String!, $label: String!) { repository(owner: $owner, name: $repo) { ${body} } }`;
}

describe('graphqlCost', () => {
  for (const [body, cost] of measured) {
    test(`matches GitHub's dry-run cost of ${cost}`, () => {
      expect(graphqlCost(wrap(body))).toBe(cost);
    });
  }

  test('a connection costs one request per node of its enclosing connections', () => {
    expect(graphqlRequests(wrap('a(first: 10) { nodes { b(first: 7) { nodes { c(last: 3) { nodes { x } } } } } }'))).toBe(1 + 10 + 70);
  });

  test('an argument object inside a call is not a nesting level', () => {
    expect(graphqlRequests(wrap('a(first: 4, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { b(first: 2) { x } } }'))).toBe(1 + 4);
  });

  test('a page size from a variable cannot be costed and throws', () => {
    expect(() => graphqlCost(wrap('a(first: $n) { nodes { x } }'))).toThrow(/not a literal integer/);
  });
});
