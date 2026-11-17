/** How a pull request's title names its ticket, for each tracker kind. Pure; the switches have no default. */

import {jiraOf, type WorkloopConfig} from '../config';
import {jiraPullRequestTitle, ticketOfJiraTitle} from './jira/pr-title';

type Kinded = Pick<WorkloopConfig, 'tracker'>;

/** The title of a ticket's pull request; the other kinds keep the `feat:` form. */
export function pullRequestTitle(config: Kinded, ticket: number, summary: string): string {
  switch (config.tracker.kind) {
    case 'jira':
      return jiraPullRequestTitle(jiraOf(config.tracker).project, ticket, summary);
    case 'github':
    case 'local':
    case 'none':
      return `feat: ${summary}`;
  }
}

/** Reads the ticket a title names; a kind that does not name tickets in the title reads none. */
export function titleReader(config: Kinded): (title: string) => number | null {
  switch (config.tracker.kind) {
    case 'jira':
      return title => ticketOfJiraTitle(jiraOf(config.tracker).project, title);
    case 'github':
    case 'local':
    case 'none':
      return () => null;
  }
}
