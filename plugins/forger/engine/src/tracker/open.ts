/** The tracker for the configured kind. */

import {backlogReader, queueHome, type WorkloopConfig} from '../config';
import {capturing, type CapturingRunner, type CommandRunner, type Tracker} from '../ports';
import {githubTracker} from './github-tracker';
import {jiraTracker} from './jira/tracker';

/** A ticket named by a number is read from GitHub for the kinds on GitHub; the kinds differ in where the queue is. Jira reads its own project. */
export function openTracker(config: Pick<WorkloopConfig, 'tracker'>, run: CommandRunner, capture: CapturingRunner = capturing(run)): Tracker {
  if (backlogReader(config) === 'jira') return jiraTracker(capture, config.tracker);
  return githubTracker(run, capture, queueHome(config));
}
