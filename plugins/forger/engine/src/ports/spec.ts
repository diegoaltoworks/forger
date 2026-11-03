/**
 * The normalized requirement report: what a spec provider yields, whichever
 * tool or format read the requirements. `check spec` decides over this shape
 * alone. Types only.
 */

export type RequirementModality = 'MUST' | 'SHOULD' | 'MAY';
export type RequirementState = 'satisfied' | 'unsatisfied' | 'unknown';

export interface RequirementStatus {
  id: string;
  modality: RequirementModality;
  state: RequirementState;
}

export interface SpecReport {
  requirements: RequirementStatus[];
}

/**
 * Reads the report of the head (the working tree) or of the base branch.
 * Returns null when it cannot: no provider installed, or no spec on that side.
 * A null is a coverage gap for the check, never a pass.
 */
export interface SpecProvider {
  report(side: 'head' | 'base'): SpecReport | null;
}
