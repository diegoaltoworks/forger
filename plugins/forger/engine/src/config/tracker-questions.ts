/**
 * What the engine asks of the configured tracker kind. Each question is a
 * switch with a branch for every kind and no default, so a kind added to the
 * config's type does not typecheck until every question answers for it.
 */

import type {WorkloopConfig} from './config';

type Kinded = Pick<WorkloopConfig, 'tracker'>;

/** Where the queue of tickets is: in the tracker, or in the backlog file. */
export function queueHome(config: Kinded): 'tracker' | 'file' {
  switch (config.tracker.kind) {
    case 'github':
    case 'jira':
      return 'tracker';
    case 'local':
    case 'none':
      return 'file';
  }
}

/** Whether the verify status is published on the code host, and required on the base branch. */
export function publishesVerifyStatus(config: Kinded): boolean {
  switch (config.tracker.kind) {
    case 'github':
    case 'jira':
      return true;
    case 'local':
    case 'none':
      return false;
  }
}

/** How a pull request names its ticket: by a closing reference or an issue-<n> branch, or by a backlog id in the branch. */
export function ticketNaming(config: Kinded): 'closing-reference' | 'backlog-id' | 'key-in-title' {
  switch (config.tracker.kind) {
    case 'github':
      return 'closing-reference';
    case 'jira':
      return 'key-in-title';
    case 'local':
    case 'none':
      return 'backlog-id';
  }
}

/** What reads the queue: GitHub Issues, a Jira project, or the backlog file. */
export function backlogReader(config: Kinded): 'github' | 'jira' | 'file' {
  switch (config.tracker.kind) {
    case 'github':
      return 'github';
    case 'jira':
      return 'jira';
    case 'local':
    case 'none':
      return 'file';
  }
}
