/** Jira Cloud as a Backlog, through an injected `CapturingRunner`. */

import {type Backlog, type BacklogData, backlogFrom} from '../backlog';
import type {WorkloopConfig} from '../../config';
import type {CapturingRunner} from '../../ports';
import {EMAIL_VARIABLE, TOKEN_VARIABLE, retryAfterSeconds, splitAnswer} from '../../tracker';
import {type JiraIssue, backlogFromJiraIssues, parseSearchPage} from './parse';
import {searchCommand} from './query';

export const RATE_LIMIT_WAIT_FALLBACK_S = 60;

/**
 * How a failure is raised. The loop's error classes are handed in because the
 * loop imports the backlog, so the backlog cannot import the loop without a cycle.
 */
export interface JiraErrors {
  rateLimit(waitSeconds: number, now: number, message: string): Error;
  unreachable(stderr: string): Error;
}

/** Why a call gave no page: a limit, no answer, a refused credential, or any other status. */
export function jiraFailure(errors: JiraErrors, exitCode: number, stdout: string, stderr: string, now: number): Error | null {
  const answer = splitAnswer(stdout);
  if (exitCode !== 0 || answer === null || answer.status === 0) return errors.unreachable(stderr);
  if (answer.status === 429) {
    const wait = retryAfterSeconds(stderr) ?? RATE_LIMIT_WAIT_FALLBACK_S;
    return errors.rateLimit(wait, now, `Jira answered 429; wait ${wait}s`);
  }
  if (answer.status === 401 || answer.status === 403) {
    return new Error(`Jira backlog: the site refused the credentials (status ${answer.status}); check ${EMAIL_VARIABLE} and ${TOKEN_VARIABLE}`);
  }
  if (answer.status >= 500) return errors.unreachable(`Jira answered ${answer.status}`);
  if (answer.status >= 400) return new Error(`Jira backlog: the search was refused with status ${answer.status}`);
  return null;
}

/** Every issue of the search, page by page until no next page token is left. */
export function readJiraIssues(run: CapturingRunner, tracker: WorkloopConfig['tracker'], errors: JiraErrors, now: () => number = Date.now): JiraIssue[] {
  const issues: JiraIssue[] = [];
  let token: string | undefined;
  do {
    const result = run(searchCommand(tracker, token));
    const failure = jiraFailure(errors, result.exitCode, result.stdout, result.stderr, now());
    if (failure) throw failure;
    const page = parseSearchPage((splitAnswer(result.stdout) as {body: string}).body);
    issues.push(...page.issues);
    token = page.nextPageToken;
  } while (token);
  return issues;
}

export function readJiraBacklog(run: CapturingRunner, tracker: WorkloopConfig['tracker'], errors: JiraErrors): BacklogData {
  return backlogFromJiraIssues(readJiraIssues(run, tracker, errors), tracker);
}

export function jiraBacklog(run: CapturingRunner, config: WorkloopConfig, errors: JiraErrors): Backlog {
  return backlogFrom(() => readJiraBacklog(run, config.tracker, errors), config);
}
