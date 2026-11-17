/** The title of a Jira ticket's pull request and the ticket a title names. Pure. */

/** `KEY-<n>: <summary>`. */
export function jiraPullRequestTitle(project: string, ticket: number, summary: string): string {
  return `${project}-${ticket}: ${summary}`;
}

/** The number in a leading `KEY-<n>` of the project, or null. */
export function ticketOfJiraTitle(project: string, title: string): number | null {
  const m = new RegExp(`^\\s*${project.replace(/[^A-Za-z0-9_]/g, '\\$&')}-(\\d+)\\b`).exec(title);
  return m ? Number(m[1]) : null;
}
