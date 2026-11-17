import {describe, expect, test} from 'bun:test';

import {jiraDefaults} from '../../config';
import type {CapturingRunner} from '../../ports';
import {formatTrackerLines, jiraSetupNote, trackerLines} from './site-check';

const settings = {...jiraDefaults(), site: 'https://example.atlassian.net', project: 'ABC', statuses: {started: 'In Progress', review: 'In Review', done: 'Done'}};
const env = {JIRA_EMAIL: 'me@example.com', JIRA_API_TOKEN: 'secret-token-value'};

/** Replays answers written to the documented shape, by the path the call names. */
function replay(answers: Record<string, {status: number; body: unknown}>): CapturingRunner {
  return cmd => {
    const path = Object.keys(answers).sort((a, b) => b.length - a.length).find(p => cmd.includes(`'https://example.atlassian.net${p}'`));
    if (!path) return {stdout: '', stderr: 'no route', exitCode: 1};
    const a = answers[path];
    return {stdout: `${JSON.stringify(a.body)}\n${a.status}`, stderr: '', exitCode: 0};
  };
}

const project = [{name: 'Task', statuses: [{name: 'To Do'}, {name: 'In Progress'}, {name: 'In Review'}, {name: 'Done'}]}];
const site = {'/rest/api/3/myself': {status: 200, body: {displayName: 'Me'}}, '/rest/api/3/project/ABC': {status: 200, body: {key: 'ABC'}}, '/rest/api/3/project/ABC/statuses': {status: 200, body: project}};

describe('check tracker', () => {
  test('check tracker for jira reports the variables, the credential, the project and each configured status', () => {
    const lines = trackerLines(settings, env, replay(site));
    expect(lines.every(l => l.ok)).toBe(true);
    expect(lines.map(l => l.text)).toEqual([
      'JIRA_EMAIL is set',
      'JIRA_API_TOKEN is set',
      'the site accepts the credential',
      'the project ABC exists',
      'status started "In Progress" exists',
      'status review "In Review" exists',
      'status done "Done" exists',
    ]);
  });

  test('a configured status the project lacks fails check tracker and names the statuses it has', () => {
    const lacking = {...site, '/rest/api/3/project/ABC/statuses': {status: 200, body: [{name: 'Task', statuses: [{name: 'To Do'}, {name: 'Doing'}]}]}};
    const lines = trackerLines(settings, env, replay(lacking));
    const failed = lines.filter(l => !l.ok);
    expect(failed.map(l => l.text)).toEqual([
      'status started "In Progress" is not a status of ABC; it has: To Do, Doing',
      'status review "In Review" is not a status of ABC; it has: To Do, Doing',
      'status done "Done" is not a status of ABC; it has: To Do, Doing',
    ]);
  });

  test('check tracker passes with one line for the other kinds and never prints a credential', () => {
    expect(trackerLines(null, {}, replay({}))).toEqual([{ok: true, text: 'the tracker needs no check'}]);
    const calls: string[] = [];
    const spy: CapturingRunner = cmd => (calls.push(cmd), replay(site)(cmd));
    const out = formatTrackerLines(trackerLines(settings, env, spy));
    expect(out).not.toContain('secret-token-value');
    expect(out).not.toContain('me@example.com');
    expect(calls.join('\n')).not.toContain('secret-token-value');
  });

  test('a missing variable is named and the calls are not made', () => {
    const lines = trackerLines(settings, {JIRA_EMAIL: 'x'}, replay({}));
    expect(lines.filter(l => !l.ok).map(l => l.text)).toEqual(['JIRA_API_TOKEN is not set', 'the credential, the project and the statuses were not checked']);
  });

  test('a refused credential and a missing project fail with the status', () => {
    expect(trackerLines(settings, env, replay({...site, '/rest/api/3/myself': {status: 401, body: {}}})).some(l => l.text.includes('HTTP 401'))).toBe(true);
    expect(trackerLines(settings, env, replay({...site, '/rest/api/3/project/ABC': {status: 404, body: {}}})).some(l => l.text.includes('ABC was not found'))).toBe(true);
  });

  test('the setup note names the missing variables', () => {
    expect(jiraSetupNote({})).toEqual({missing_variables: ['JIRA_EMAIL', 'JIRA_API_TOKEN'], checks_run: false});
    expect(jiraSetupNote(env).checks_run).toBe(true);
  });
});
