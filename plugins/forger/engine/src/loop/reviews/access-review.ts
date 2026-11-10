/**
 * The access review, the safety pack's periodic whole-app read of who can read
 * and change whose data. Pure decisions; `access-review-io.ts` files it.
 */

import type {ReviewKind} from './schedule';

export const ACCESS_REVIEW: ReviewKind = {
  label: 'access-review',
  title: 'An access review: who can read and change whose data',
  template: '.forger/templates/access-review.md',
  filedEvent: 'access_review_filed',
};

export interface AccessReviewFacts {
  merged: number;
  /** An open issue already carries the review label. */
  reviewOpen: boolean;
}

/** Why an access review is due, or null. An every_merged of 0 is off. */
export function accessReviewDue(everyMerged: number, facts: AccessReviewFacts): string | null {
  if (facts.reviewOpen || everyMerged <= 0 || facts.merged < everyMerged) return null;
  return `${facts.merged} tickets merged since the last access review (every_merged ${everyMerged})`;
}
