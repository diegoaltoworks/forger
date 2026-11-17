/**
 * Linking what an issue's `Blocked by` section names as native blocked-by
 * dependencies, so intake never leaves a dependency written only in prose.
 * Every tracker call goes through the injected runner.
 */

import type {Tracker} from '../ports';
import {blockersToLink, parseBlockedBy} from './blocked-by';

export interface LinkResult {
  issue: number;
  linked: number[];
  already: number[];
}

function readIssue(tracker: Tracker, issue: number) {
  const links = tracker.links(issue);
  if (!links) throw new Error(`link-blockers: issue #${issue} was not found`);
  return links;
}

/** Links every issue under the issue's `Blocked by` heading that is not already linked. */
export function linkBlockers(tracker: Tracker, issue: number): LinkResult {
  const me = readIssue(tracker, issue);
  const declared = parseBlockedBy(me.body);
  const todo = blockersToLink(issue, declared, me.native);
  const linked: number[] = [];
  for (const blocker of todo) {
    const other = readIssue(tracker, blocker);
    tracker.apply({kind: 'block', blocked: me.ref, blocker: other.ref});
    linked.push(blocker);
  }
  return {issue, linked, already: declared.filter(n => n !== issue && me.native.includes(n))};
}
