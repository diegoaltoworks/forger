/** The tracker for the configured kind. */

import {queueHome, type WorkloopConfig} from '../config';
import type {CapturingRunner, CommandRunner, Tracker} from '../ports';
import {githubTracker} from './github-tracker';

/** A ticket named by a number is read from GitHub whatever the kind; the kinds differ in where the queue is. */
export function openTracker(config: Pick<WorkloopConfig, 'tracker'>, run: CommandRunner, capture?: CapturingRunner): Tracker {
  return githubTracker(run, capture, queueHome(config));
}
