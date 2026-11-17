/** The Tracker port over the Jira call. A ticket's number is the number in its key. */

import {type JiraSettings, type WorkloopConfig, jiraOf} from '../../config';
import type {CapturingRunner, CommandResult, OpenTicket, StatusEvent, TicketDetail, TicketFact, TicketFacts, TicketLinks, TicketQuery, TicketState, TicketSummary, Tracker, TrackerWrite, WholeResult} from '../../ports';
import {adfToMarkdown} from './adf-to-markdown';
import type {AdfNode} from './adf';
import {type JiraCallInput, jiraCall, splitAnswer} from './call';
import {jqlString} from './jql';
import {markdownToAdf} from './markdown-to-adf';
import {mergedWrites, moveTo, wantedStatus, type Transition} from './status/moves';

type Config = WorkloopConfig['tracker'];

interface Issue {
  key: string;
  fields?: {
    summary?: string;
    description?: AdfNode | null;
    labels?: string[];
    status?: {statusCategory?: {key?: string}};
    issuelinks?: Array<{type?: {name?: string}; inwardIssue?: {key: string}}>;
  };
}

const ISSUE_FIELDS = 'summary,description,labels,status,issuelinks';

export function numberOfKey(key: string): number {
  return Number(key.slice(key.lastIndexOf('-') + 1));
}

const isDone = (i: Issue): boolean => i.fields?.status?.statusCategory?.key === 'done';
const textOf = (i: Issue): string => (i.fields?.description ? adfToMarkdown(i.fields.description) : '');

export function jiraTracker(capture: CapturingRunner, config: Config, log: (line: string) => void = () => {}): Tracker {
  const settings: JiraSettings = jiraOf(config);
  const key = (n: number): string => `${settings.project}-${n}`;
  const issuePath = (n: number): string => `/rest/api/3/issue/${key(n)}`;

  /** One call; a failure names the status and never the credentials. */
  function send(call: JiraCallInput): CommandResult {
    const r = capture(jiraCall(settings, call));
    const answer = splitAnswer(r.stdout);
    if (r.exitCode !== 0 || answer === null) return {stdout: '', stderr: r.stderr || 'Jira gave no answer', exitCode: r.exitCode || 1};
    if (answer.status >= 400) return {stdout: answer.body, stderr: `Jira answered ${answer.status}`, exitCode: 1};
    return {stdout: answer.body, stderr: r.stderr, exitCode: 0};
  }
  function sendOrThrow(call: JiraCallInput): string {
    const r = send(call);
    if (r.exitCode !== 0) throw new Error(`Jira ${call.method} ${call.path.split('?')[0]}: ${r.stderr}`);
    return r.stdout;
  }
  const json = <T>(call: JiraCallInput): T => JSON.parse(sendOrThrow(call) || '{}') as T;
  const readIssue = (n: number): Issue => json<Issue>({method: 'GET', path: `${issuePath(n)}?fields=${ISSUE_FIELDS}`});

  function search(jql: string, limit = 100): Issue[] {
    const found: Issue[] = [];
    let token: string | undefined;
    do {
      const path = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${ISSUE_FIELDS}&maxResults=${Math.min(limit - found.length, 100)}${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`;
      const page = json<{issues?: Issue[]; nextPageToken?: string}>({method: 'GET', path});
      found.push(...(page.issues ?? []));
      token = page.nextPageToken;
    } while (token && found.length < limit);
    return found;
  }
  const inProject = (...terms: string[]): string => [`project = ${jqlString(settings.project)}`, ...terms].join(' AND ') + ' ORDER BY key ASC';
  const queryJql = (q: TicketQuery): string =>
    inProject(...[q.state === 'open' ? 'statusCategory != Done' : q.state === 'closed' ? 'statusCategory = Done' : '', q.label === undefined ? '' : `labels = ${jqlString(q.label)}`, q.title === undefined ? '' : `summary ~ ${jqlString(q.title)}`].filter(Boolean));
  const blockers = (i: Issue): number[] =>
    (i.fields?.issuelinks ?? []).filter(l => l.type?.name === settings.blocks_link && l.inwardIssue).map(l => numberOfKey((l.inwardIssue as {key: string}).key));

  function request(w: TrackerWrite): JiraCallInput {
    switch (w.kind) {
      case 'file':
        return {method: 'POST', path: '/rest/api/3/issue', body: {fields: {project: {key: settings.project}, summary: w.title, issuetype: {name: 'Task'}, description: markdownToAdf(w.body), labels: w.labels}}};
      case 'comment':
        return {method: 'POST', path: `${issuePath(w.ticket)}/comment`, body: {body: markdownToAdf(w.body)}};
      case 'body':
        return {method: 'PUT', path: issuePath(w.ticket), body: {fields: {description: markdownToAdf(w.body)}}};
      case 'labels':
        return {method: 'PUT', path: issuePath(w.ticket), body: {update: {labels: [...w.add.map(add => ({add})), ...w.remove.map(remove => ({remove}))]}}};
      case 'block':
        return {method: 'POST', path: '/rest/api/3/issueLink', body: {type: {name: settings.blocks_link}, inwardIssue: {key: w.blocked}, outwardIssue: {key: w.blocker}}};
      case 'pin':
      case 'createLabel':
        throw new Error(`a ${w.kind} write makes no call`);
    }
  }
  const quiet = (w: TrackerWrite): boolean => w.kind === 'pin' || w.kind === 'createLabel';
  const address = (stdout: string, w: TrackerWrite): string => (w.kind === 'file' ? `${settings.site.replace(/\/+$/, '')}/browse/${(JSON.parse(stdout) as {key: string}).key}` : '');

  function move(n: number, event: StatusEvent, pr?: string): string[] {
    const lines: string[] = [];
    const status = wantedStatus(settings, event);
    try {
      if (status !== null) {
        const offered = json<{transitions?: Transition[]}>({method: 'GET', path: `${issuePath(n)}/transitions`}).transitions ?? [];
        const m = moveTo(status, key(n), offered);
        if (m.do === 'transition') sendOrThrow({method: 'POST', path: `${issuePath(n)}/transitions`, body: {transition: {id: m.id}}});
        if (m.do === 'log') lines.push(m.line);
      } else if (event === 'done' && pr) {
        for (const w of mergedWrites(settings, n, pr, config.label)) sendOrThrow(request(w));
      }
    } catch (e) {
      lines.push(`${key(n)}: the ${event} move failed: ${(e as Error).message}`);
    }
    for (const l of lines) log(l);
    return lines;
  }

  return {
    queue: 'tracker',
    text: ((n: number, how?: WholeResult) => {
      if (how) {
        const r = send({method: 'GET', path: `${issuePath(n)}?fields=description`});
        return r.exitCode === 0 ? {...r, stdout: textOf(JSON.parse(r.stdout) as Issue)} : r;
      }
      return textOf(JSON.parse(sendOrThrow({method: 'GET', path: `${issuePath(n)}?fields=description`})) as Issue);
    }) as Tracker['text'],
    facts(n): TicketFacts {
      const i = readIssue(n);
      return {labels: i.fields?.labels ?? [], body: textOf(i)};
    },
    labels: n => readIssue(n).fields?.labels ?? [],
    state(n): TicketState {
      return {state: isDone(readIssue(n)) ? 'CLOSED' : 'OPEN', closedBy: []};
    },
    lastComment(n) {
      const page = json<{comments?: Array<{body?: AdfNode}>}>({method: 'GET', path: `${issuePath(n)}/comment?orderBy=-created&maxResults=1`});
      const last = page.comments?.[0]?.body;
      return last ? adfToMarkdown(last).trim() : '';
    },
    exists: n => send({method: 'GET', path: `${issuePath(n)}?fields=summary`}).exitCode === 0,
    list: (q): TicketSummary[] => search(queryJql(q), q.limit).map(i => ({number: numberOfKey(i.key), title: i.fields?.summary ?? ''})),
    tickets: (q): TicketDetail[] => search(queryJql(q), q.limit).map(i => ({number: numberOfKey(i.key), title: i.fields?.summary ?? '', labels: i.fields?.labels ?? [], body: textOf(i)})),
    openTickets: (label): OpenTicket[] => search(inProject('statusCategory != Done', `labels = ${jqlString(label)}`)).map(i => ({number: numberOfKey(i.key), body: textOf(i), native: blockers(i)})),
    links(n): TicketLinks | null {
      const r = send({method: 'GET', path: `${issuePath(n)}?fields=${ISSUE_FIELDS}`});
      if (r.exitCode !== 0) return null;
      const i = JSON.parse(r.stdout) as Issue;
      return {ref: i.key, body: textOf(i), native: blockers(i)};
    },
    ticketFacts(tickets): ReadonlyMap<number, TicketFact> {
      const facts = new Map<number, TicketFact>();
      if (tickets.length === 0) return facts;
      const keys = tickets.map(key).map(jqlString).join(', ');
      for (const i of search(`key in (${keys})`, tickets.length)) facts.set(numberOfKey(i.key), {closed: isDone(i), mergedPr: null});
      return facts;
    },
    listCommand: label => `${settings.site.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(inProject(`labels = ${jqlString(label)}`))}`,
    repoLabels: () => [config.label, ...ENGINE_LABELS],
    account: ((how?: WholeResult) => {
      const r = send({method: 'GET', path: '/rest/api/3/myself'});
      const named = (out: string): string => {
        const me = JSON.parse(out) as {displayName?: string; accountId?: string};
        return me.displayName ?? me.accountId ?? '';
      };
      if (how) return r.exitCode === 0 ? {...r, stdout: named(r.stdout)} : r;
      if (r.exitCode !== 0) throw new Error(`Jira GET /rest/api/3/myself: ${r.stderr}`);
      return named(r.stdout);
    }) as Tracker['account'],
    moveStatus: move,
    apply: ((w: TrackerWrite, how?: WholeResult) => {
      if (quiet(w)) return how ? {stdout: '', stderr: '', exitCode: 0} : '';
      const r = send(request(w));
      if (how) return r.exitCode === 0 ? {...r, stdout: address(r.stdout, w)} : r;
      if (r.exitCode !== 0) throw new Error(`Jira ${request(w).method} ${request(w).path}: ${r.stderr}`);
      return address(r.stdout, w);
    }) as Tracker['apply'],
  };
}

/** The labels besides the intake label that the loop reads or sets on an issue. */
const ENGINE_LABELS = ['needs-info', 'needs-human', 'halted', 'owner-review', 'deferred', 'needs-triage', 'flaky-gate', 'merged', 'P0', 'P1', 'P2', 'P3', 'effort:small', 'effort:medium', 'effort:large'];
