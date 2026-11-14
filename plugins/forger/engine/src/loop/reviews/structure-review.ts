/**
 * When the loop files a whole-repo structure review: pure decisions over the
 * event record, the structure baseline and the open reviews.
 */

import type {StructureReviewConfig} from '../../checks';
import type {TerminalEvent} from '../events';
import {mergesSinceFiled, type ReviewKind} from './schedule';

export const STRUCTURE_REVIEW_LABEL = 'structure-review';

export const STRUCTURE_REVIEW: ReviewKind = {
  label: STRUCTURE_REVIEW_LABEL,
  title: 'A structure review of the whole repository',
  template: '.forger/templates/structure-review.md',
  filedEvent: 'structure_review_filed',
};

/** Merges recorded since the last review was filed, or since the first event when none was. */
export function mergesSinceReview(events: TerminalEvent[]): number {
  return mergesSinceFiled(events, STRUCTURE_REVIEW.filedEvent);
}

export interface ReviewFacts {
  merged: number;
  baselineEntries: number;
  /** An open issue already carries the review label. */
  reviewOpen: boolean;
}

/** Why a review is due, or null. A threshold of 0 is off. */
export function reviewDue(config: StructureReviewConfig, facts: ReviewFacts): string | null {
  if (facts.reviewOpen) return null;
  if (config.every_merged > 0 && facts.merged >= config.every_merged) return `${facts.merged} tickets merged since the last review (every_merged ${config.every_merged})`;
  if (config.warnings_over > 0 && facts.baselineEntries > config.warnings_over) return `${facts.baselineEntries} entries in the structure baseline (warnings_over ${config.warnings_over})`;
  return null;
}
