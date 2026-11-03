/**
 * The pure core of `check spec`: join the requirement IDs the PR's issue names,
 * the head report and the base report, and decide. Modality sets severity: an
 * unsatisfied MUST is a violation; an unsatisfied SHOULD warns and an
 * unsatisfied MAY informs, as gaps do. Anything that cannot be measured is a
 * gap, never a pass.
 */

import type {SpecProvider, SpecReport} from '../../ports';
import type {Gap, Modality} from '../gaps';
import type {Finding} from '../waivers';

export const SPEC_FILE = 'spec';

const NAMES = 'spec.ticket-names-requirements';
const SATISFIED = 'spec.named-requirements-satisfied';
const NO_REGRESS = 'spec.must-never-regresses';

/** The provider of a project with none installed: every report is unavailable. */
export const absentSpecProvider: SpecProvider = {report: () => null};

/** The IDs on `Satisfies:` lines of an issue body, in order, each once. */
export function parseSatisfies(body: string): string[] {
  const ids: string[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s*(?:[-*]\s*)?Satisfies:\s*(.*)$/i.exec(line);
    if (!m) continue;
    for (const id of m[1].split(/[\s,]+/)) if (id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The issue number a branch named `feat/issue-<n>` works, else null. */
export function issueFromBranch(branch: string): number | null {
  const m = /^feat\/issue-(\d+)$/.exec(branch.trim());
  return m ? Number(m[1]) : null;
}

export interface SpecInputs {
  /** The IDs the issue names; null when the issue could not be read. */
  named: string[] | null;
  head: SpecReport | null;
  base: SpecReport | null;
}

export interface SpecSummary {
  total: number;
  satisfied: number;
  unsatisfied: number;
  unknown: number;
}

export interface SpecDecision {
  findings: Finding[];
  gaps: Gap[];
  /** Null when there is no head report. The share unknown is the adoption measure. */
  summary: SpecSummary | null;
}

const finding = (rule: string, opinion: string, detail: string): Finding => ({file: SPEC_FILE, line: 0, rule, opinion, detail});
const gap = (opinion: string, modality: Modality, detail: string): Gap => ({file: SPEC_FILE, opinion, modality, detail});

export function summarize(report: SpecReport): SpecSummary {
  const count = (state: string) => report.requirements.filter(r => r.state === state).length;
  return {total: report.requirements.length, satisfied: count('satisfied'), unsatisfied: count('unsatisfied'), unknown: count('unknown')};
}

export function decideSpec({named, head, base}: SpecInputs): SpecDecision {
  const findings: Finding[] = [];
  const gaps: Gap[] = [];

  if (named === null) gaps.push(gap(NAMES, 'SHOULD', 'the PR\'s issue could not be read, so the requirements it names are unknown'));
  else if (named.length === 0) findings.push(finding('no-satisfies', NAMES, 'the issue has no Satisfies: line naming requirement IDs'));

  if (head === null) {
    gaps.push(gap(SATISFIED, 'MUST', 'no requirement report is available (no spec provider), so nothing was measured'));
    return {findings, gaps, summary: null};
  }

  const byId = new Map(head.requirements.map(r => [r.id, r]));
  for (const id of named ?? []) {
    const req = byId.get(id);
    if (!req) gaps.push(gap(SATISFIED, 'MUST', `${id} is named by the issue but is not in the spec`));
    else if (req.state === 'unknown') gaps.push(gap(SATISFIED, req.modality, `${id} is named by the issue and is unknown (no validator reports it)`));
    else if (req.state === 'unsatisfied') {
      if (req.modality === 'MUST') findings.push(finding('named-unsatisfied', SATISFIED, `${id} (MUST) is named by the issue and is unsatisfied`));
      else gaps.push(gap(SATISFIED, req.modality, `${id} is named by the issue and is unsatisfied`));
    }
  }

  if (base === null) gaps.push(gap(NO_REGRESS, 'SHOULD', 'no base report is available, so regressions were not measured'));
  else {
    for (const was of base.requirements) {
      if (was.modality !== 'MUST' || was.state !== 'satisfied') continue;
      const now = byId.get(was.id);
      if (!now || now.state !== 'satisfied') {
        findings.push(finding('must-regressed', NO_REGRESS, `${was.id} (MUST) was satisfied on the base and is ${now ? now.state : 'missing'} now`));
      }
    }
  }
  return {findings, gaps, summary: summarize(head)};
}
