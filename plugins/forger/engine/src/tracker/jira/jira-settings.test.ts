import {describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {jiraProblems, loadConfig, mergeConfig} from '../../config';
import {EMAIL_VARIABLE, TOKEN_VARIABLE, jiraCall, jiraUrl} from './call';

const jira = (j: Record<string, unknown>) => mergeConfig({tracker: {kind: 'jira', jira: j as never}}).tracker;
const good = {site: 'https://example.atlassian.net', project: 'ABC'};

describe('the Jira settings', () => {
  test('a config with the kind jira and a site and a project loads, with the default priority map and the default link type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forger-jira-'));
    mkdirSync(join(dir, '.forger'));
    writeFileSync(join(dir, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'jira', jira: good}}));
    const t = loadConfig(dir).tracker;
    expect(t.kind).toBe('jira');
    expect(t.jira?.blocks_link).toBe('Blocks');
    expect(t.jira?.priority).toEqual({Highest: 'P0', High: 'P1', Medium: 'P2', Low: 'P3', Lowest: 'P3'});
  });

  test('loadConfig refuses a config with a problem and prints each', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forger-jira-'));
    mkdirSync(join(dir, '.forger'));
    writeFileSync(join(dir, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'jira'}}));
    expect(() => loadConfig(dir)).toThrow(/site is missing[\s\S]*project is missing/);
  });

  test('each problem of the Jira settings is named: no site, a site that is not https, no project, a project that is not a key, a priority outside P0 to P3, effort limits out of order', () => {
    expect(jiraProblems(jira(good))).toEqual([]);
    expect(jiraProblems(jira({project: 'ABC'}))[0]).toMatch(/site is missing/);
    expect(jiraProblems(jira({...good, site: 'http://x.net'}))[0]).toMatch(/not an https address/);
    expect(jiraProblems(jira({site: good.site}))[0]).toMatch(/project is missing/);
    expect(jiraProblems(jira({...good, project: 'abc'}))[0]).toMatch(/not a project key/);
    expect(jiraProblems(jira({...good, priority: {Urgent: 'P9'}}))[0]).toMatch(/"Urgent" to "P9"/);
    expect(jiraProblems(jira({...good, effort: {field: 'customfield_1', small_max: 5, medium_max: 5}}))[0]).toMatch(/out of order/);
    expect(jiraProblems(jira({}))).toHaveLength(2);
  });

  test('other kinds have no Jira problems', () => {
    expect(jiraProblems(mergeConfig({}).tracker)).toEqual([]);
  });
});

describe('a Jira call', () => {
  const site = {site: 'https://example.atlassian.net/'};

  test('the command of a Jira call holds the names of the two variables and never their values, and the token is not an argument of curl', () => {
    const cmd = jiraCall(site, {method: 'GET', path: '/rest/api/3/myself'});
    expect(cmd).toContain(`$${EMAIL_VARIABLE}`);
    expect(cmd).toContain(`$${TOKEN_VARIABLE}`);
    const curl = cmd.slice(cmd.indexOf('curl'));
    expect(curl).not.toContain(TOKEN_VARIABLE);
    expect(curl).not.toContain(EMAIL_VARIABLE);
    expect(curl).toContain('--config -');
    expect(curl).not.toMatch(/\s(-u|--user)\s/);
  });

  test('the secret values never reach the command text', () => {
    const cmd = jiraCall(site, {method: 'POST', path: '/x', body: {a: 1}});
    const run = Bun.spawnSync(['sh', '-c', cmd.replace('curl', 'echo curl').split(' | ')[0] as string], {env: {JIRA_EMAIL: 'a@b.test', JIRA_API_TOKEN: 'tok-secret'}});
    expect(cmd).not.toContain('tok-secret');
    expect(run.stdout.toString()).toContain('tok-secret');
    expect(cmd).toContain(`--data-binary '{"a":1}'`);
  });

  test('a cloud id sends the call through the gateway', () => {
    expect(jiraUrl({...site, cloud_id: 'abc-123'}, '/rest/api/3/x')).toBe('https://api.atlassian.com/ex/jira/abc-123/rest/api/3/x');
    expect(jiraUrl(site, '/rest/api/3/x')).toBe('https://example.atlassian.net/rest/api/3/x');
  });
});
