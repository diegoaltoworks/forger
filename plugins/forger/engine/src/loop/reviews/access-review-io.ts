/**
 * Files the access review after a merge. A project without the safety pack,
 * or with `access_review.every_merged` unset or 0, is left alone.
 */

import {existsSync, readFileSync} from 'fs';

import {parseSafetyConfig, SAFETY_PATH} from '../../checks';
import {forgerPath} from '../../config';
import type {CommandRunner} from '../../ports';
import {parseAllEvents} from '../events';
import {ACCESS_REVIEW, accessReviewDue} from './access-review';
import {createReviewIssue, mergesSinceFiled, reviewIsOpen} from './schedule';

/** The reason a review was filed, or null when none was. `eventsText` is the event file as written. */
export function fileAccessReview(projectRoot: string, run: CommandRunner, intakeLabel: string, eventsText: string, template: string): string | null {
  const file = forgerPath(projectRoot, SAFETY_PATH);
  if (!existsSync(file)) return null;
  const everyMerged = parseSafetyConfig(readFileSync(file, 'utf-8')).access_review?.every_merged ?? 0;
  if (everyMerged <= 0) return null;
  const merged = mergesSinceFiled(parseAllEvents(eventsText), ACCESS_REVIEW.filedEvent);
  if (merged < everyMerged) return null;
  const reason = accessReviewDue(everyMerged, {merged, reviewOpen: reviewIsOpen(run, ACCESS_REVIEW)});
  if (reason === null) return null;
  createReviewIssue(run, ACCESS_REVIEW, intakeLabel, template);
  return reason;
}
