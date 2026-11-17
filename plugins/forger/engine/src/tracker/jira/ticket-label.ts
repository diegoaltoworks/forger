/** How a Jira ticket shows in a report, and which ticket a merged pull request closed. Pure. */

import type {JiraSettings} from '../../config';
import {ticketOfJiraTitle} from './pr-title';

/** `ABC-12 (https://site/browse/ABC-12)` for ticket id `issue-12`; any other text stays as it is. */
export function jiraTicketLabel(settings: Pick<JiraSettings, 'site' | 'project'>, ticket: string): string {
  const n = /^issue-(\d+)$/.exec(ticket)?.[1];
  if (n === undefined) return ticket;
  const key = `${settings.project}-${n}`;
  return `${key} (${settings.site.replace(/\/+$/, '')}/browse/${key})`;
}

/** The ticket a merged pull request closed: the one its title's key names. */
export function jiraClosingTicket(settings: Pick<JiraSettings, 'project'>, pr: {title: string}): number | null {
  return ticketOfJiraTitle(settings.project, pr.title);
}
