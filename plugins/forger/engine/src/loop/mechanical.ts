/**
 * Criteria a check decides (ADR 0010, option c). A criterion bound to a spec
 * requirement with `[spec:ID]` in its text, whose requirement the head's spec
 * report shows satisfied, is recorded `met` with the spec check as evidence and
 * is left out of what the verifier is asked to judge. Anything else, including
 * a bound criterion whose requirement is not satisfied or not reported, stays
 * with the verifier. Pure.
 */

import type {SpecReport} from '../ports';
import type {CheckedEntry, Criterion, Decision} from './verdict';
import {reduceVerdict} from './verdict';

const BINDING = /\[spec:([^\]\s]+)\]/;

/** The requirement ID a criterion is bound to; null when it is not bound. */
export function boundRequirement(criterion: Criterion): string | null {
  return BINDING.exec(criterion.text)?.[1] ?? null;
}

export interface Partition {
  /** Criteria decided by the spec check, recorded met. */
  mechanical: CheckedEntry[];
  /** Criteria the verifier judges. */
  remaining: Criterion[];
}

export function partitionCriteria(criteria: Criterion[], report: SpecReport | null): Partition {
  const mechanical: CheckedEntry[] = [];
  const remaining: Criterion[] = [];
  for (const c of criteria) {
    const id = boundRequirement(c);
    const satisfied = id !== null && report?.requirements.some(r => r.id === id && r.state === 'satisfied');
    if (satisfied) mechanical.push({criterion: c.id, verdict: 'met', evidence: [{kind: 'check', ref: `spec:${id}`}]});
    else remaining.push(c);
  }
  return {mechanical, remaining};
}

/** The verifier's entries and the mechanical ones, in the ticket's criterion order, and the decision over all of them. */
export function mergeEntries(
  criteria: Criterion[],
  mechanical: CheckedEntry[],
  judged: CheckedEntry[],
): {entries: CheckedEntry[]; decision: Decision} {
  const order = new Map(criteria.map((c, i) => [c.id, i]));
  const entries = [...mechanical, ...judged].sort((a, b) => (order.get(a.criterion) ?? 0) - (order.get(b.criterion) ?? 0));
  return {entries, decision: reduceVerdict(entries)};
}
