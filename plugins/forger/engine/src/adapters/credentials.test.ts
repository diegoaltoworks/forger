import {afterEach, describe, expect, test} from 'bun:test';
import {generateKeyPairSync} from 'crypto';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {backlogFrom} from '../backlog';
import {mergeConfig} from '../config';
import {AutomationRunner} from '../loop';
import type {Sandbox, SupervisedResult} from '../ports';
import {localStateFor} from './local-state-store';
import {allModelVariables, credentialPlan, modelCredential, redact, repoSlug} from './credentials';
import {githubToken, type GithubApi} from './github-token';
import {agentFor, HARNESSES} from './harnesses';
import {redactingSandbox} from './redacting-sandbox';
import {claudeHarness} from './claude';
import {dockerSandbox} from './docker-sandbox';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const SECRET = 'sk-test-0123456789abcdef';

describe('model credentials', () => {
  test('each harness maps api_key and subscription to the variable its CLI reads', () => {
    const table = Object.fromEntries(
      HARNESSES.map(h => [h.id, {api_key: modelCredential(h, 'api_key'), subscription: modelCredential(h, 'subscription')}])
    );
    expect(table.claude.api_key).toEqual({ok: true, variables: ['ANTHROPIC_API_KEY']});
    expect(table.claude.subscription).toEqual({ok: true, variables: ['CLAUDE_CODE_OAUTH_TOKEN']});
    expect(table.codex.api_key).toEqual({ok: true, variables: ['CODEX_API_KEY', 'OPENAI_API_KEY']});
    expect(table.copilot.subscription).toEqual({ok: true, variables: ['COPILOT_GITHUB_TOKEN']});
    expect(table.opencode.api_key).toEqual({ok: true, variables: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']});
  });

  test('a kind the CLI documents no variable for is refused, naming the kind that works', () => {
    const refused = modelCredential(HARNESSES.find(h => h.id === 'copilot')!, 'api_key');
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error).toContain('use subscription');
  });

  test('the plan passes the chosen kind only, and every variable when the config names none', () => {
    const none = mergeConfig({});
    expect(credentialPlan(none, claudeHarness).variables).toEqual(allModelVariables(claudeHarness));
    const sub = mergeConfig({credentials: {model: {claude: 'subscription'}}});
    expect(credentialPlan(sub, claudeHarness).variables).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
    const bad = mergeConfig({credentials: {model: {codex: 'subscription'}}});
    expect(credentialPlan(bad, HARNESSES.find(h => h.id === 'codex')!).error).toContain('codex');
  });

  test('the config refuses a kind that is neither api_key nor subscription', () => {
    expect(() => mergeConfig({credentials: {model: {claude: 'password' as never}}})).toThrow('api_key');
    expect(() => mergeConfig({credentials: {github: {source: 'file' as never}}})).toThrow('env');
  });
});

describe('redaction', () => {
  test('replaces every occurrence and ignores values too short to be a secret', () => {
    expect(redact(`a ${SECRET} b ${SECRET}`, [SECRET])).toBe('a [redacted] b [redacted]');
    expect(redact('abc abc', ['abc'])).toBe('abc abc');
  });
});

describe('the GitHub token', () => {
  const { privateKey } = generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
  const app = mergeConfig({credentials: {github: {source: 'app'}}}).credentials.github;

  function fakeGithub() {
    const calls: {method: string; path: string; body?: unknown; bearer: string}[] = [];
    const api: GithubApi = {
      async request(method, path, bearer, body) {
        calls.push({method, path, body, bearer});
        if (method === 'GET' && path === '/repos/acme/widgets/installation') return {status: 200, body: {id: 77}};
        if (method === 'POST' && path === '/app/installations/77/access_tokens') return {status: 201, body: {token: 'ghs_minted'}};
        return {status: 404, body: null};
      },
    };
    return {api, calls};
  }

  test('a GitHub App installation token is minted per run for the one repository', async () => {
    const gh = fakeGithub();
    const input = {github: app, env: {FORGER_APP_ID: '123', FORGER_APP_PRIVATE_KEY: privateKey}, origin: 'https://github.com/acme/widgets.git', api: gh.api, nowSeconds: 1_000_000};
    expect(await githubToken(input)).toEqual({ok: true, token: 'ghs_minted'});
    expect(await githubToken(input)).toEqual({ok: true, token: 'ghs_minted'});
    const mints = gh.calls.filter(c => c.method === 'POST');
    expect(mints).toHaveLength(2);
    expect(mints[0].body).toEqual({repositories: ['widgets']});
    const claims = JSON.parse(Buffer.from(mints[0].bearer.split('.')[1], 'base64url').toString());
    expect(claims.iss).toBe('123');
    expect(claims.exp - 1_000_000).toBeLessThan(10 * 60);
  });

  test('an app that is not installed, or a missing key, is reported and nothing is minted', async () => {
    const gh = fakeGithub();
    const base = {github: app, env: {FORGER_APP_ID: '123', FORGER_APP_PRIVATE_KEY: privateKey}, api: gh.api, nowSeconds: 1};
    const other = await githubToken({...base, origin: 'https://github.com/acme/other.git'});
    expect(other.ok).toBe(false);
    expect(gh.calls.some(c => c.method === 'POST')).toBe(false);
    const nokey = await githubToken({...base, env: {}, origin: 'https://github.com/acme/widgets.git'});
    expect(nokey.ok ? '' : nokey.error).toContain('FORGER_APP_ID');
  });

  test('the env source reads the named variable and the slug reads both remote forms', async () => {
    const env = mergeConfig({credentials: {github: {variable: 'MY_TOKEN'}}}).credentials.github;
    const r = await githubToken({github: env, env: {MY_TOKEN: 'tok'}, origin: '', api: fakeGithub().api, nowSeconds: 0});
    expect(r).toEqual({ok: true, token: 'tok'});
    expect(repoSlug('https://github.com/acme/widgets.git')).toEqual({owner: 'acme', name: 'widgets'});
    expect(repoSlug('git' + '@github.com:acme/widgets.git')).toEqual({owner: 'acme', name: 'widgets'});
    expect(repoSlug('https://example.com/acme/widgets.git')).toBeNull();
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe('records', () => {
  test('a credential value never appears in the iteration log, the events file or a verdict', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-redact-'));
    dirs.push(root);
    mkdirSync(join(root, '.forger'), {recursive: true});
    const leaky: SupervisedResult = {exitCode: 1, signal: null, output: `auth failed with ${SECRET}\n<process>stop</process> token ${SECRET} rejected`, timedOut: false};
    const inner: Sandbox = {
      id: 'fake',
      prepare: r => ({ok: true, ticket: r.ticket, path: root}),
      cleanup: () => null,
      start: () => ({result: Promise.resolve(leaky), end: () => {}}),
    };
    const box = redactingSandbox(inner, new Set(), ['ANTHROPIC_API_KEY'], {ANTHROPIC_API_KEY: SECRET});
    const config = mergeConfig({limits: {pauseBetweenIterations: 0, pauseAfterFailure: 0, killGraceSeconds: 0, maxStallIterations: 99}});
    const tickets = {features: {tk_a: {priority: 'P1', status: 'not_started', body: '## Knock-on\n`src/a.ts`\n'}}};
    const runner = new AutomationRunner(root, config, backlogFrom(() => tickets, config), {
      stateStore: localStateFor(root, config),
      agent: agentFor(claudeHarness, {}, box),
      sandbox: box,
      gitRunner: () => '',
      gitCapture: () => ({stdout: '', stderr: '', exitCode: 0}),
      folderMap: {roots: ['src'], folders: ['src']},
      sleep: async () => {},
    });
    await runner.run(1);

    // The verifier reads the same agent seam, so a verdict is built from the same redacted output.
    const verifierSeen = await agentFor(claudeHarness, {}, box).run({
      prompt: 'p', cwd: root, sessionId: 's', tier: {model: 'standard', budget: 1}, model: 'm', timeoutMinutes: 1, killGraceSeconds: 0,
    } as never);
    expect(verifierSeen.output).toContain('[redacted]');
    expect(verifierSeen.output).not.toContain(SECRET);

    const files = filesUnder(join(root, '.forger'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, 'utf-8')).not.toContain(SECRET);
  });
});

describe('the docker sandbox credentials', () => {
  test('a minted token reaches the container by name only and is redacted from its output', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
    const root = mkdtempSync(join(tmpdir(), 'forger-cred-'));
    dirs.push(root);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), `#!/bin/sh\nif [ "$1" = create ]; then echo "ARGS $*" >> ${join(root, 'created')}; echo "TOKEN=$GH_TOKEN KEY=$CLAUDE_CODE_OAUTH_TOKEN" >> ${join(root, 'created')}; exit 0; fi\ncat ${join(root, 'created')}\n`, {mode: 0o755});
    const cwd = join(root, 'issue-7');
    mkdirSync(cwd);
    const requests: string[] = [];
    const api: GithubApi = {
      async request(method, path) {
        requests.push(`${method} ${path}`);
        return path.endsWith('/installation') ? {status: 200, body: {id: 5}} : {status: 201, body: {token: 'ghs_minted_value'}};
      },
    };
    const config = mergeConfig({credentials: {github: {source: 'app'}, model: {claude: 'subscription'}}});
    const plan = credentialPlan(config, claudeHarness);
    const git = (cmd: string) => ({stdout: cmd.startsWith('git remote get-url') ? 'https://github.com/acme/widgets.git' : cmd.includes('rev-parse') ? 'feat/issue-7' : '', stderr: '', exitCode: 0});
    const known = new Set<string>();
    const env = {FORGER_APP_ID: '9', FORGER_APP_PRIVATE_KEY: privateKey, CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-value', ANTHROPIC_API_KEY: 'api-key-value-123'};
    const box = redactingSandbox(dockerSandbox(git, {projectRoot: root, pluginRoot: '/p', baseBranch: 'main', image: 'w:1', credentials: plan, secrets: known, env, api, nonce: () => 'n'}), known, plan.variables, env);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    const done = await box.start({command: 'claude', args: [], cwd, input: '', timeoutMs: 5000, graceMs: 100, env: {CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-value'}}).result;
    process.env.PATH = path;
    expect(requests).toEqual(['GET /repos/acme/widgets/installation', 'POST /app/installations/5/access_tokens']);
    const args = done.output.split('\n').find(l => l.startsWith('ARGS'))!;
    expect(args).toContain('-e GH_TOKEN');
    expect(args).toContain('-e CLAUDE_CODE_OAUTH_TOKEN');
    expect(args).not.toContain('ANTHROPIC_API_KEY');
    expect(args).not.toContain('ghs_minted_value');
    expect(done.output).toContain('TOKEN=[redacted] KEY=[redacted]');
  });

  test('a kind the harness has no variable for stops the run before docker starts', async () => {
    const plan = credentialPlan(mergeConfig({credentials: {model: {codex: 'subscription'}}}), HARNESSES.find(h => h.id === 'codex')!);
    const root = mkdtempSync(join(tmpdir(), 'forger-cred-'));
    dirs.push(root);
    const git = (cmd: string) => ({stdout: cmd.startsWith('git remote get-url') ? 'https://github.com/acme/widgets.git' : '', stderr: '', exitCode: 0});
    const done = await dockerSandbox(git, {projectRoot: root, pluginRoot: '/p', baseBranch: 'main', image: 'w:1', credentials: plan}).start({command: 'codex', args: [], cwd: root, input: '', timeoutMs: 1000, graceMs: 10}).result;
    expect(done.exitCode).toBe(1);
    expect(done.output).toContain('codex');
  });
});
