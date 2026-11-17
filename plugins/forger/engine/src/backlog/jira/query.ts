/** The search of the Jira backlog: its query and the call for each page. Pure. */

import {type WorkloopConfig, jiraOf} from '../../config';
import {jiraCall, jqlString} from '../../tracker';

type Tracker = WorkloopConfig['tracker'];

export const SEARCH_PATH = '/rest/api/3/search/jql';
export const PAGE_SIZE = 50;

/** The project and the open work, then the intake label or the configured jql in its place. */
export function jiraQuery(tracker: Tracker): string {
  const {project, jql} = jiraOf(tracker);
  const intake = jql && jql.trim() !== '' ? `(${jql})` : `labels = ${jqlString(tracker.label)}`;
  return `project = ${jqlString(project)} AND statusCategory != Done AND ${intake} ORDER BY key ASC`;
}

/** The fields the parser reads, with the effort field when one is configured. */
export function jiraFields(tracker: Tracker): string[] {
  const fields = ['summary', 'description', 'labels', 'status', 'priority', 'issuelinks'];
  const effort = jiraOf(tracker).effort;
  if (effort) fields.push(effort.field);
  return fields;
}

export function searchPath(tracker: Tracker, nextPageToken?: string): string {
  const params = [
    `jql=${encodeURIComponent(jiraQuery(tracker))}`,
    `fields=${encodeURIComponent(jiraFields(tracker).join(','))}`,
    `maxResults=${PAGE_SIZE}`,
  ];
  if (nextPageToken) params.push(`nextPageToken=${encodeURIComponent(nextPageToken)}`);
  return `${SEARCH_PATH}?${params.join('&')}`;
}

export function searchCommand(tracker: Tracker, nextPageToken?: string): string {
  return jiraCall(jiraOf(tracker), {method: 'GET', path: searchPath(tracker, nextPageToken)});
}
