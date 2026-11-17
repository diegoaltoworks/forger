/** The settings of the tracker kind `jira`, and what they are when the config leaves them out. */

export interface JiraSettings {
  /** The https address of the Jira Cloud site. */
  site: string;
  /** The key of the project that is the backlog. */
  project: string;
  /** Replaces the intake label test of the query when set. */
  jql?: string;
  statuses?: {started?: string; review?: string; done?: string};
  /** Jira priority name -> `P0`-`P3`. */
  priority: Record<string, string>;
  /** A number field whose value is sorted into small, medium and large by two limits. */
  effort?: {field: string; small_max: number; medium_max: number};
  /** The issue link type whose inward side is "blocked by". */
  blocks_link: string;
  /** Set when the token works only through the vendor's gateway. */
  cloud_id?: string;
}

export const DEFAULT_JIRA_PRIORITY: Record<string, string> = {Highest: 'P0', High: 'P1', Medium: 'P2', Low: 'P3', Lowest: 'P3'};

export const DEFAULT_BLOCKS_LINK = 'Blocks';

export function jiraDefaults(): JiraSettings {
  return {site: '', project: '', priority: {...DEFAULT_JIRA_PRIORITY}, blocks_link: DEFAULT_BLOCKS_LINK};
}

/** The Jira settings of a tracker: its own, or the defaults when it has none. */
export function jiraOf(tracker: {jira?: JiraSettings}): JiraSettings {
  return tracker.jira ?? jiraDefaults();
}

/** The user's Jira settings over the defaults; the priority map is merged name by name. */
export function mergeJira(user: Partial<JiraSettings> | undefined): JiraSettings {
  const base = jiraDefaults();
  return {...base, ...(user ?? {}), priority: {...base.priority, ...(user?.priority ?? {})}};
}

const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

/** Every problem of the Jira settings, named; none for another kind. */
export function jiraProblems(tracker: {kind: string; jira?: JiraSettings}): string[] {
  if (tracker.kind !== 'jira') return [];
  const {site, project, priority, effort} = jiraOf(tracker);
  const found: string[] = [];
  if (site.trim() === '') found.push('tracker.jira.site is missing: give the https address of the Jira site');
  else if (!/^https:\/\/[^\s/]+/.test(site)) found.push(`tracker.jira.site "${site}" is not an https address`);
  if (project.trim() === '') found.push('tracker.jira.project is missing: give the key of the project');
  else if (!PROJECT_KEY.test(project)) found.push(`tracker.jira.project "${project}" is not a project key (capital letters, digits and underscores, such as ABC)`);
  for (const [name, mapped] of Object.entries(priority)) {
    if (!PRIORITIES.has(mapped)) found.push(`tracker.jira.priority maps "${name}" to "${mapped}", which is not one of P0, P1, P2, P3`);
  }
  if (effort && !(effort.small_max < effort.medium_max)) {
    found.push(`tracker.jira.effort limits are out of order: small_max (${effort.small_max}) must be below medium_max (${effort.medium_max})`);
  }
  return found;
}
