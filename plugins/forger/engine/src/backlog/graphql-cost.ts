/**
 * The worst-case rate-limit cost of a GraphQL query, computed from its text the
 * way GitHub computes it: every connection costs one request per node its
 * enclosing connections can return (the product of their `first`/`last`), and
 * the query costs the sum over 100, rounded, and never less than 1. Reading the
 * page sizes off the query text itself keeps one source for both, so a raised
 * page size cannot slip past the budget test.
 */

const OPEN_OR_CALL = /([A-Za-z_][\w]*)\s*(\([^)]*\))?\s*\{|\}/g;
const PAGE_SIZE = /\b(?:first|last)\s*:\s*([^\s,)]+)/;

/** Requests the query can make, before GitHub's divide-by-100. */
export function graphqlRequests(query: string): number {
  const stack: number[] = [];
  let requests = 0;
  for (const match of query.matchAll(OPEN_OR_CALL)) {
    if (match[0] === '}') {
      stack.pop();
      continue;
    }
    const size = match[2]?.match(PAGE_SIZE)?.[1];
    if (size === undefined) {
      stack.push(1);
      continue;
    }
    const n = Number(size);
    if (!Number.isInteger(n)) {
      throw new Error(`graphql cost: page size "${size}" of ${match[1]} is not a literal integer`);
    }
    requests += stack.reduce((product, s) => product * s, 1);
    stack.push(n);
  }
  return requests;
}

export function graphqlCost(query: string): number {
  return Math.max(1, Math.round(graphqlRequests(query) / 100));
}
