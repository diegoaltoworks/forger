import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandResult} from '../ports';
import {cloneUrl, dockerCheck, imagePlan, parseJsonc, repoKey, runArgs} from './docker-plan';
import {dockerSandbox} from './docker-sandbox';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

/** Built in two parts so the writing rules do not read it as an address. */
const SSH_REMOTE = 'git' + '@github.com:acme/widgets.git';

const ok = (stdout = ''): CommandResult => ({stdout, stderr: '', exitCode: 0});

/** A repository root, a plugin root, and a fake docker that records what it is asked. */
function site(devcontainer?: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'forger-docker-'));
  dirs.push(root);
  for (const [path, text] of Object.entries(devcontainer ?? {})) {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), text);
  }
  const calls: string[] = [];
  const git = (cmd: string): CommandResult => {
    calls.push(cmd);
    if (cmd.startsWith('git remote get-url')) return ok(SSH_REMOTE);
    if (cmd.includes('rev-parse --abbrev-ref')) return ok('feat/issue-7');
    return ok();
  };
  const box = dockerSandbox(git, {projectRoot: root, pluginRoot: '/plugin', baseBranch: 'main', passthrough: ['ANTHROPIC_API_KEY'], nonce: () => 'n1'});
  return {root, calls, box};
}

describe('the docker sandbox', () => {
  test('the docker sandbox builds the run command with the image, clone, caches and no host mounts', async () => {
    const {calls, box, root} = site();
    const ws = box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: join(root, '.forger')});
    expect(ws.ok).toBe(true);
    expect(calls.some(c => c.startsWith('docker build') && c.includes('forger-sandbox:base') && c.includes('/plugin/sandbox/Dockerfile'))).toBe(true);

    // The run goes through a fake docker on the PATH that records its arguments and echoes the prompt.
    const bin = mkdtempSync(join(tmpdir(), 'forger-fakebin-'));
    dirs.push(bin);
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\necho "ARGS $*"\necho "KEY=$ANTHROPIC_API_KEY BASE=$FORGER_BASE ORIGIN=$FORGER_ORIGIN BRANCH=$FORGER_BRANCH"\ncat\n', {mode: 0o755});
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    const cwd = join(root, '.forger', 'worktrees', 'issue-7');
    mkdirSync(cwd, {recursive: true});
    const done = await box.start({command: 'claude', args: ['-p'], cwd, env: {ANTHROPIC_API_KEY: 'secret'}, input: 'the prompt', timeoutMs: 5000, graceMs: 100}).result;
    process.env.PATH = path;
    expect(done.exitCode).toBe(0);
    expect(done.output).toContain('the prompt');
    expect(done.output).toContain('BASE=main ORIGIN=https://github.com/acme/widgets.git BRANCH=feat/issue-7');
    expect(done.output).toContain('KEY=secret');
    const args = done.output.split('\n').find(l => l.startsWith('ARGS'))!;
    expect(args).toContain('run --rm -i --name forger-issue-7-n1');
    expect(args).not.toContain('secret');
    expect(args).toContain('source=forger-cache-github-com-acme-widgets-bun,target=/cache/bun');
    expect(args).toContain('source=forger-cache-github-com-acme-widgets-uv,target=/cache/uv');
    expect(args).toContain('source=forger-cache-github-com-acme-widgets-npm,target=/cache/npm');
    expect(args).toContain('forger-sandbox:base');
    expect(calls).toContain("docker rm -f 'forger-issue-7-n1'");
  });

  test('no argument mounts the host', () => {
    const args = runArgs({name: 'n', image: 'img', repoKey: 'k', origin: 'https://x/y', baseBranch: 'main', branch: 'feat/a', command: 'claude', args: [], passthrough: []});
    expect(args.filter(a => a === '-v' || a === '--volume')).toEqual([]);
    for (const a of args.filter(a => a.startsWith('type='))) expect(a).toMatch(/^type=volume,source=forger-cache-/);
    expect(args.join(' ')).not.toMatch(/ \/tmp|\/home/);
  });

  test('the docker sandbox uses the devcontainer image when the repository has one', () => {
    const named = site({'.devcontainer/devcontainer.json': '{\n // the toolchain\n "image": "ghcr.io/acme/dev:1", }'});
    expect(named.box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: join(named.root, '.forger')}).ok).toBe(true);
    expect(named.calls.some(c => c.startsWith('docker build'))).toBe(false);

    const built = site({'.devcontainer/devcontainer.json': '{"build": {"dockerfile": "Dockerfile", "context": ".."}}', '.devcontainer/Dockerfile': 'FROM scratch'});
    built.box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: join(built.root, '.forger')});
    const build = built.calls.find(c => c.startsWith('docker build'))!;
    expect(build).toContain(`-f '${join(built.root, '.devcontainer/Dockerfile')}'`);
    expect(build).toContain(`'${built.root}'`);
    expect(build).toContain('forger-sandbox:github-com-acme-widgets');
    expect(build).not.toContain('forger-sandbox:base');
  });

  test('a failed image build is reported, not thrown', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-docker-'));
    dirs.push(root);
    const box = dockerSandbox(cmd => (cmd.startsWith('docker build') ? {stdout: '', stderr: 'no space', exitCode: 1} : ok('https://x/y.git')), {projectRoot: root, pluginRoot: '/p', baseBranch: 'main'});
    const w = box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: root});
    expect(w).toEqual({ok: false, ticket: 'issue-7', error: expect.stringContaining('no space')});
  });
});

describe('the docker plan', () => {
  const base = {tag: 'b', dockerfile: '/p/Dockerfile', context: '/p'};

  test('picks an image, a build, the Dockerfile beside it, or the base', () => {
    expect(imagePlan({dir: '.devcontainer', text: '{"image":"x:1"}'}, false, base, 't')).toEqual({kind: 'image', image: 'x:1'});
    expect(imagePlan({dir: '.devcontainer', text: '{"build":{"dockerfile":"../Dockerfile"}}'}, false, base, 't')).toEqual({kind: 'build', tag: 't', dockerfile: 'Dockerfile', context: '.devcontainer'});
    expect(imagePlan(null, true, base, 't')).toEqual({kind: 'build', tag: 't', dockerfile: '.devcontainer/Dockerfile', context: '.devcontainer'});
    expect(imagePlan({dir: '', text: 'not json'}, false, base, 't')).toEqual({kind: 'build', ...base});
    expect(imagePlan(null, false, base, 't')).toEqual({kind: 'build', ...base});
  });

  test('reads JSONC and keeps urls inside strings', () => {
    expect(parseJsonc('{"u": "http://a//b", /* c */ "n": [1,],}')).toEqual({u: 'http://a//b', n: [1]});
  });

  test('clones an ssh remote over https and keys caches by repository', () => {
    expect(cloneUrl(SSH_REMOTE)).toBe('https://github.com/acme/widgets.git');
    expect(cloneUrl('https://github.com/acme/widgets.git')).toBe('https://github.com/acme/widgets.git');
    expect(repoKey(SSH_REMOTE)).toBe(repoKey('https://github.com/acme/widgets'));
  });
});

describe('dockerCheck', () => {
  test('a reachable API needs no fix', () => {
    expect(dockerCheck({exitCode: 0, stderr: ''})).toEqual({ok: true, fix: []});
  });
  test('names the fix for each way it fails', () => {
    expect(dockerCheck({exitCode: 1, stderr: 'permission denied while trying to connect to the Docker daemon socket'}).fix.join()).toContain('docker group');
    expect(dockerCheck({exitCode: 127, stderr: 'docker: command not found'}).fix.join()).toContain('install Docker');
    expect(dockerCheck({exitCode: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock'}).fix.join()).toContain('rootless');
  });
});
