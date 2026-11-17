/**
 * What `check tracker` says about the tracker: for `jira`, the two variables,
 * the credential, the project and each configured status, one line each. A
 * line never holds a credential. The calls go through the capturing runner.
 */

import type {JiraSettings} from '../../config';
import type {CapturingRunner} from '../../ports';
import {EMAIL_VARIABLE, TOKEN_VARIABLE, jiraCall, splitAnswer} from './call';

export interface TrackerLine {
  ok: boolean;
  text: string;
}

type Env = Record<string, string | undefined>;

export const STATUS_EVENTS = ['started', 'review', 'done'] as const;

/** The credential variables that are unset or empty. */
export function missingVariables(env: Env): string[] {
  return [EMAIL_VARIABLE, TOKEN_VARIABLE].filter(v => (env[v] ?? '').trim() === '');
}

/** Each configured status that the project's statuses lack. Names compare without case. */
export function lackedStatuses(configured: JiraSettings['statuses'], has: string[]): Array<{event: string; status: string}> {
  const known = new Set(has.map(s => s.toLowerCase()));
  return STATUS_EVENTS.flatMap(event => {
    const status = configured?.[event];
    return status && status.trim() !== '' && !known.has(status.toLowerCase()) ? [{event, status}] : [];
  });
}

export function statusNames(body: string): string[] {
  const types = JSON.parse(body) as Array<{statuses?: Array<{name?: string}>}>;
  return [...new Set(types.flatMap(t => (t.statuses ?? []).map(s => s.name ?? '').filter(n => n !== '')))];
}

function ask(capture: CapturingRunner, settings: JiraSettings, path: string): {status: number; body: string} {
  const r = capture(jiraCall(settings, {method: 'GET', path}));
  const answer = r.exitCode === 0 ? splitAnswer(r.stdout) : null;
  return answer ?? {status: 0, body: ''};
}

/** The lines for the Jira settings; null settings (any other kind) is one passing line. */
export function trackerLines(settings: JiraSettings | null, env: Env, capture: CapturingRunner): TrackerLine[] {
  if (settings === null) return [{ok: true, text: 'the tracker needs no check'}];
  const missing = missingVariables(env);
  const lines: TrackerLine[] = [
    ...[EMAIL_VARIABLE, TOKEN_VARIABLE].map(v => ({ok: !missing.includes(v), text: missing.includes(v) ? `${v} is not set` : `${v} is set`})),
  ];
  if (missing.length > 0) return [...lines, {ok: false, text: 'the credential, the project and the statuses were not checked'}];

  const me = ask(capture, settings, '/rest/api/3/myself');
  lines.push(me.status >= 200 && me.status < 300 ? {ok: true, text: 'the site accepts the credential'} : {ok: false, text: me.status === 0 ? 'the site gave no answer' : `the site refused the credential (HTTP ${me.status})`});
  if (!lines[lines.length - 1].ok) return [...lines, {ok: false, text: 'the project and the statuses were not checked'}];

  const project = ask(capture, settings, `/rest/api/3/project/${encodeURIComponent(settings.project)}`);
  if (project.status < 200 || project.status >= 300) return [...lines, {ok: false, text: `the project ${settings.project} was not found (HTTP ${project.status})`}, {ok: false, text: 'the statuses were not checked'}];
  lines.push({ok: true, text: `the project ${settings.project} exists`});

  const answer = ask(capture, settings, `/rest/api/3/project/${encodeURIComponent(settings.project)}/statuses`);
  if (answer.status < 200 || answer.status >= 300) return [...lines, {ok: false, text: `the statuses could not be read (HTTP ${answer.status})`}];
  const has = statusNames(answer.body);
  const lacked = lackedStatuses(settings.statuses, has);
  for (const event of STATUS_EVENTS) {
    const status = settings.statuses?.[event];
    if (!status || status.trim() === '') continue;
    const miss = lacked.find(l => l.event === event);
    lines.push(miss ? {ok: false, text: `status ${event} "${status}" is not a status of ${settings.project}; it has: ${has.join(', ')}`} : {ok: true, text: `status ${event} "${status}" exists`});
  }
  return lines;
}

export function formatTrackerLines(lines: TrackerLine[]): string {
  return lines.map(l => `${l.ok ? 'ok  ' : 'FAIL'} ${l.text}`).join('\n');
}

export interface JiraSetupNote {
  missing_variables: string[];
  /** False when a variable is missing: the credential, the project and the statuses are then unchecked. */
  checks_run: boolean;
}

export function jiraSetupNote(env: Env): JiraSetupNote {
  const missing = missingVariables(env);
  return {missing_variables: missing, checks_run: missing.length === 0};
}

export function formatJiraSetupNote(note: JiraSetupNote): string[] {
  return note.checks_run
    ? []
    : [`! ${note.missing_variables.join(' and ')} not set: the checks have not run; set them, then run check tracker`];
}
