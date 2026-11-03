/**
 * Coverage gaps: a check that could not measure something. A gap is neither a
 * pass nor a failure, so a report never reads an unmeasured requirement as
 * satisfied. How loudly it speaks depends on the requirement's modality.
 * Pure; waivers match a gap by opinion id and path, as they match a finding.
 */

import type {RequirementModality} from '../ports';
import {applyWaivers, type Finding, type Waiver} from './waivers';

export type Modality = RequirementModality;
export type GapSeverity = 'fail' | 'warn' | 'inform';

export interface Gap {
  file: string;
  opinion: string;
  modality: Modality;
  /** What could not be measured, and why. */
  detail: string;
}

export interface ReportedGap extends Gap {
  severity: GapSeverity;
  waiver?: Waiver;
}

/** MUST fails the check, SHOULD warns, MAY informs. */
export function severityFor(modality: Modality): GapSeverity {
  return modality === 'MUST' ? 'fail' : modality === 'SHOULD' ? 'warn' : 'inform';
}

/** Gaps with their severity; a waiver covering the opinion and path marks the gap waived, whatever its severity. */
export function classifyGaps(gaps: Gap[], waivers: Waiver[]): ReportedGap[] {
  const asFindings: Finding[] = gaps.map(g => ({file: g.file, line: 0, rule: 'coverage-gap', opinion: g.opinion, detail: g.detail}));
  const {waived} = applyWaivers(asFindings, waivers);
  return gaps.map((g, i): ReportedGap => {
    const hit = waived.find(w => w.file === asFindings[i].file && w.opinion === g.opinion && w.detail === g.detail);
    return {...g, severity: severityFor(g.modality), ...(hit ? {waiver: hit.waiver} : {})};
  });
}

/** Only an unwaived MUST gap fails a check. */
export function gapsFail(gaps: ReportedGap[]): boolean {
  return gaps.some(g => g.severity === 'fail' && !g.waiver);
}

/** Any gap left open: a check with one is `unmeasured`, never `passed`. */
export function gapsOpen(gaps: ReportedGap[]): boolean {
  return gaps.some(g => !g.waiver);
}
