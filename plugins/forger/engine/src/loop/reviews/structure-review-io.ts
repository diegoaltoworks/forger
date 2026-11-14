/**
 * Files the structure review spike after a merge. A project without the
 * structure pack, or not on GitHub, is left alone.
 */

import {existsSync, readFileSync} from 'fs';

import {parseStructureBaseline, parseStructureConfig, STRUCTURE_BASELINE_PATH, STRUCTURE_PATH} from '../../checks';
import {forgerPath} from '../../config';
import type {CommandRunner} from '../../ports';
import {parseAllEvents, type TerminalEvent} from '../events';
import {createReviewIssue, reviewIsOpen} from './schedule';
import {mergesSinceReview, reviewDue, STRUCTURE_REVIEW} from './structure-review';

function read(projectRoot: string, rel: string): string | null {
  const file = forgerPath(projectRoot, rel);
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

/** The reason a review was filed, or null when none was. `eventsText` is the event file as written. */
export function fileStructureReview(projectRoot: string, run: CommandRunner, intakeLabel: string, eventsText: string, template: string): string | null {
  const configText = read(projectRoot, STRUCTURE_PATH);
  if (configText === null) return null;
  const config = parseStructureConfig(configText);
  const baselineText = read(projectRoot, STRUCTURE_BASELINE_PATH);
  const baselineEntries = baselineText === null ? 0 : parseStructureBaseline(baselineText).entries.length;
  const events: TerminalEvent[] = parseAllEvents(eventsText);
  const reason = reviewDue(config.review, {merged: mergesSinceReview(events), baselineEntries, reviewOpen: reviewIsOpen(run, STRUCTURE_REVIEW)});
  if (reason === null) return null;
  createReviewIssue(run, STRUCTURE_REVIEW, intakeLabel, template);
  return reason;
}
