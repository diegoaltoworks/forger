import {describe, expect, test} from 'bun:test';

import type {Sandbox, SandboxStart} from '../ports';
import {agentFor} from './harnesses';
import {findHarness} from './harnesses';
import {githubToken} from './github-token';
import {runArgs, runEnv} from './docker-plan';

function recordingSandbox(): {box: Sandbox; starts: SandboxStart[]} {
  const starts: SandboxStart[] = [];
  const box: Sandbox = {
    id: 'fake',
    prepare: r => ({ok: true, ticket: r.ticket, path: '/x'}),
    start(spec) {
      starts.push(spec);
      return {result: Promise.resolve({exitCode: 0, signal: null, output: '', timedOut: false}), end() {}};
    },
    cleanup: () => null,
  };
  return {box, starts};
}

describe('the verifier in a sandbox', () => {
  test('verify starts its run through the sandbox seam with a read-only token', async () => {
    const {box, starts} = recordingSandbox();
    const agent = agentFor(findHarness('claude'), {}, box);
    await agent.run({prompt: 'p', sessionId: 's', tier: {model: 'deep', budget: 1}, model: 'opus', workerCommand: 'forger:verify', cwd: '/scratch/verify-5-a', timeoutMinutes: 2, killGraceSeconds: 3, readOnly: true, ref: 'pull/5/head'});
    expect(starts).toHaveLength(1);
    expect(starts[0].readOnly).toBe(true);
    expect(starts[0].ref).toBe('pull/5/head');
    expect(starts[0].timeoutMs).toBe(120000);
    expect(starts[0].graceMs).toBe(3000);
  });

  test('a worker run is not read-only', async () => {
    const {box, starts} = recordingSandbox();
    await agentFor(findHarness('claude'), {}, box).run({prompt: 'p', sessionId: 's', tier: {model: 'deep', budget: 1}, model: 'opus', workerCommand: 'x', cwd: '/w', timeoutMinutes: 1, killGraceSeconds: 1});
    expect(starts[0].readOnly).toBeUndefined();
  });

  test('a read-only app token asks GitHub for read permissions only', async () => {
    const bodies: unknown[] = [];
    const api = {
      async request(method: 'GET' | 'POST', path: string, _b: string, body?: unknown) {
        if (method === 'GET') return {status: 200, body: {id: 9}};
        bodies.push(body);
        return {status: 201, body: {token: 'ro'}};
      },
    };
    const {generateKeyPairSync} = await import('crypto');
    const key = generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({type: 'pkcs1', format: 'pem'}).toString();
    const github = {source: 'app' as const, variable: 'GH_TOKEN', read_variable: 'GH_READ_TOKEN', app_id_variable: 'ID', app_key_variable: 'KEY'};
    const env = {ID: '1', KEY: key};
    const origin = 'https://github.com/acme/widgets.git';
    await githubToken({github, env, origin, api, nowSeconds: 1, readOnly: true});
    await githubToken({github, env, origin, api, nowSeconds: 1});
    const perms = (bodies[0] as {permissions: Record<string, string>}).permissions;
    expect(Object.values(perms).every(v => v === 'read')).toBe(true);
    expect((bodies[1] as {permissions?: unknown}).permissions).toBeUndefined();
  });

  test('a read-only env token comes from its own variable, never the write token', async () => {
    const github = {source: 'env' as const, variable: 'GH_TOKEN', read_variable: 'GH_READ_TOKEN', app_id_variable: 'a', app_key_variable: 'b'};
    const api = {request: async () => ({status: 500, body: null})};
    const common = {github, origin: 'o', api, nowSeconds: 1, readOnly: true};
    expect(await githubToken({...common, env: {GH_TOKEN: 'write'}})).toEqual({ok: true, token: null});
    expect(await githubToken({...common, env: {GH_TOKEN: 'write', GH_READ_TOKEN: 'read'}})).toEqual({ok: true, token: 'read'});
  });

  test('the container checks out the ref it is given', () => {
    const input = {name: 'n', image: 'i', repoKey: 'k', origin: 'https://x/y', baseBranch: 'main', branch: 'b', command: 'c', args: [], passthrough: [], ref: 'pull/5/head'};
    expect(runArgs(input).join(' ')).toContain('FORGER_REF');
    expect(runEnv(input, undefined).FORGER_REF).toBe('pull/5/head');
    expect(runEnv({origin: 'https://x/y', baseBranch: 'main', branch: 'b'}, undefined).FORGER_REF).toBeUndefined();
  });
});
