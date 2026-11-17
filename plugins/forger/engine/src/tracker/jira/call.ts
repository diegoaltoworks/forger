/**
 * The `curl` command of one Jira Cloud call. The command text names the two
 * environment variables and never holds their values: the shell's own printf
 * writes the account and token into a curl config on standard input, so they
 * are in no argument of any process.
 */

import {quote} from '../quote';

export const EMAIL_VARIABLE = 'JIRA_EMAIL';
export const TOKEN_VARIABLE = 'JIRA_API_TOKEN';

export interface JiraSite {
  site: string;
  cloud_id?: string;
}

export interface JiraCallInput {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** The path with its query, such as `/rest/api/3/search/jql?jql=...`. */
  path: string;
  body?: unknown;
}

/** The address a path is called at: the site, or the vendor's gateway for a cloud id. */
export function jiraUrl(settings: JiraSite, path: string): string {
  const base = settings.cloud_id ? `https://api.atlassian.com/ex/jira/${settings.cloud_id}` : settings.site.replace(/\/+$/, '');
  return `${base}${path}`;
}

/**
 * The answer is the body, then a last line holding the HTTP status; the
 * response headers go to standard error, where a rate limit names its wait.
 */
export function jiraCall(settings: JiraSite, call: JiraCallInput): string {
  const config = `printf 'user = "%s:%s"\\n' "$${EMAIL_VARIABLE}" "$${TOKEN_VARIABLE}"`;
  const args = ['curl -sS --config -', `-X ${call.method}`, `-H 'Accept: application/json'`, '--dump-header /dev/stderr', `-w '\\n%{http_code}'`];
  if (call.body !== undefined) {
    args.push(`-H 'Content-Type: application/json'`, `--data-binary ${quote(JSON.stringify(call.body))}`);
  }
  args.push(quote(jiraUrl(settings, call.path)));
  return `${config} | ${args.join(' ')}`;
}

export interface JiraAnswer {
  status: number;
  body: string;
}

/** Splits the answer of `jiraCall`; null when there is no status line, which is no answer. */
export function splitAnswer(stdout: string): JiraAnswer | null {
  const at = stdout.lastIndexOf('\n');
  const status = Number(stdout.slice(at + 1).trim());
  if (at < 0 || !Number.isInteger(status) || status < 100) return null;
  return {status, body: stdout.slice(0, at)};
}

/** Seconds a `Retry-After` header in the dumped headers asks to wait, or null. */
export function retryAfterSeconds(headers: string): number | null {
  const m = /^retry-after:\s*(\d+)/im.exec(headers);
  return m ? Number(m[1]) : null;
}
