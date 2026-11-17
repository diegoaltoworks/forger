/**
 * Which Backlog the engine reads, from the tracker kind: GitHub Issues for
 * `github`, the backlog.json file for `local` and `none` (ADR 0001).
 */

import {join} from 'path';

import type {Backlog} from '../backlog';
import {backlogReader, type WorkloopConfig} from '../config';
import {fileBacklog} from '../backlog';
import {execCapture} from '../adapters';
import {type CommandRunner, capturing} from '../ports';
import {type JiraErrors, githubBacklog, jiraBacklog} from '../backlog';
import {RateLimitError, TrackerUnreachableError} from '../loop';

export type BacklogSource = 'github' | 'jira' | 'file';

const jiraErrors: JiraErrors = {
  rateLimit: (wait, now, message) => new RateLimitError('jira', {resource: 'jira', limit: 0, remaining: 0, resetAt: now + wait * 1000}, message),
  unreachable: stderr => new TrackerUnreachableError(stderr),
};

export function backlogSource(config: WorkloopConfig): BacklogSource {
  return backlogReader(config);
}

export function openBacklog(
  projectRoot: string,
  config: WorkloopConfig,
  run?: CommandRunner
): Backlog {
  const source = backlogSource(config);
  if (source === 'file') return fileBacklog(join(projectRoot, config.paths.backlog), config);
  const capture = run ? capturing(run) : execCapture(projectRoot);
  return source === 'jira' ? jiraBacklog(capture, config, jiraErrors) : githubBacklog(capture, config);
}
