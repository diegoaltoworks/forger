/**
 * The I/O half of `check spec`: finds the issue the branch works, reads its
 * body, asks the provider for the head and base reports and hands the three to
 * the pure decision. An unreadable issue is a gap, not a pass.
 */

import type {CommandRunner, SpecProvider} from '../../ports';
import {absentSpecProvider, decideSpec, issueFromBranch, parseSatisfies, type SpecDecision} from './spec';

function namedRequirements(run: CommandRunner): string[] | null {
  try {
    const issue = issueFromBranch(run('git branch --show-current'));
    if (issue === null) return null;
    return parseSatisfies(run(`gh issue view ${issue} --json body --jq .body`));
  } catch {
    return null;
  }
}

export function runSpecDecision(run: CommandRunner, provider: SpecProvider = absentSpecProvider): SpecDecision {
  return decideSpec({named: namedRequirements(run), head: provider.report('head'), base: provider.report('base')});
}
