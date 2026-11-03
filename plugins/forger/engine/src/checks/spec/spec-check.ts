/**
 * The I/O half of `check spec`: finds the issue the branch works, reads its
 * body, asks the provider for the head and base reports and hands the three to
 * the pure decision. An unreadable issue is a gap, not a pass.
 */

import {SpecOutputError, type CommandRunner, type SpecProvider, type SpecReport} from '../../ports';
import {SPEC_FILE, absentSpecProvider, decideSpec, issueFromBranch, parseSatisfies, type SpecDecision} from './spec';

function namedRequirements(run: CommandRunner): string[] | null {
  try {
    const issue = issueFromBranch(run('git branch --show-current'));
    if (issue === null) return null;
    return parseSatisfies(run(`gh issue view ${issue} --json body --jq .body`));
  } catch {
    return null;
  }
}

/** A provider whose output is malformed cannot measure that side: the report is absent and the reason is kept. */
function read(provider: SpecProvider, side: 'head' | 'base', errors: string[]): SpecReport | null {
  try {
    return provider.report(side);
  } catch (e) {
    if (!(e instanceof SpecOutputError)) throw e;
    errors.push(`${side}: ${e.message}`);
    return null;
  }
}

export function runSpecDecision(run: CommandRunner, provider: SpecProvider = absentSpecProvider): SpecDecision {
  const errors: string[] = [];
  const decision = decideSpec({named: namedRequirements(run), head: read(provider, 'head', errors), base: read(provider, 'base', errors)});
  for (const detail of errors) decision.gaps.push({file: SPEC_FILE, opinion: 'spec.named-requirements-satisfied', modality: 'MUST', detail: `the spec provider's output was unreadable (${detail})`});
  return decision;
}
