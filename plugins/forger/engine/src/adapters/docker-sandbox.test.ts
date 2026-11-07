import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandResult} from '../ports';
import {cloneUrl, dockerCheck, imagePlan, parseJsonc, repoKey, runArgs} from './docker-plan';
import {classifyExit} from '../loop';
import {dockerSandbox} from './docker-sandbox';
import {sandboxFor} from './sandboxes';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

/** Built in two parts so the writing rules do not read it as an address. */
const SSH_REMOTE = 'git' + '@github.com:acme/widgets.git';

const ok = (stdout = ''): CommandResult => ({stdout, stderr: '', exitCode: 0});

/** A repository root, a plugin root, and a fake docker that records what it is asked. */
function site(devcontainer?: Record<string, string>, image: string | null = 'img:1') {
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
  const box = dockerSandbox(git, {projectRoot: root, pluginRoot: '/plugin', baseBranch: 'main', passthrough: ['ANTHROPIC_API_KEY'], nonce: () => 'n1', image});
  return {root, calls, box};
}

describe('the docker sandbox', () => {
  test('the docker sandbox builds the run command with the image, clone, caches and no host mounts', async () => {
    const {calls, box, root} = site();
    const ws = box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: join(root, '.forger')});
    expect(ws.ok).toBe(true);
    expect(calls.some(c => c.startsWith('docker build'))).toBe(false);

    // A fake docker on the PATH records what it is asked to create; start echoes the prompt.
    const bin = mkdtempSync(join(tmpdir(), 'forger-fakebin-'));
    dirs.push(bin);
    const log = join(bin, 'log');
    writeFileSync(join(bin, 'docker'), `#!/bin/sh\nif [ "$1" = create ]; then echo "ARGS $*" >> ${log}; echo "KEY=$ANTHROPIC_API_KEY BASE=$FORGER_BASE ORIGIN=$FORGER_ORIGIN BRANCH=$FORGER_BRANCH" >> ${log}; exit 0; fi\necho "STARTED $*"\ncat\n`, {mode: 0o755});
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    const cwd = join(root, '.forger', 'worktrees', 'issue-7');
    mkdirSync(cwd, {recursive: true});
    const done = await box.start({command: 'claude', args: ['-p'], cwd, env: {ANTHROPIC_API_KEY: 'secret'}, input: 'the prompt', timeoutMs: 5000, graceMs: 100}).result;
    process.env.PATH = path;
    expect(done.exitCode).toBe(0);
    expect(done.output).toContain('the prompt');
    expect(done.output).toContain('STARTED start -a -i forger-issue-7-n1');
    const created = readFileSync(log, 'utf-8');
    expect(created).toContain('BASE=main ORIGIN=https://github.com/acme/widgets.git BRANCH=feat/issue-7');
    expect(created).toContain('KEY=secret');
    const args = created.split('\n').find(l => l.startsWith('ARGS'))!;
    expect(args).toContain('create -i --name forger-issue-7-n1');
    expect(args).not.toContain('secret');
    expect(args).toContain('source=forger-cache-github-com-acme-widgets-bun,target=/cache/bun');
    expect(args).toContain('source=forger-cache-github-com-acme-widgets-uv,target=/cache/uv');
    expect(args).toContain('source=forger-cache-github-com-acme-widgets-npm,target=/cache/npm');
    expect(args).toContain(' img:1 ');
    expect(calls).toContain("docker rm -f 'forger-issue-7-n1'");
  });

  test('the docker sandbox copies the engine\'s plugin into the container and sets FORGER_PLUGIN_ROOT', async () => {
    const {calls, box, root} = site();
    const bin = mkdtempSync(join(tmpdir(), 'forger-fakebin-'));
    dirs.push(bin);
    const log = join(bin, 'log');
    writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> ${log}\ncat >/dev/null\n`, {mode: 0o755});
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    const cwd = join(root, '.forger', 'worktrees', 'issue-7');
    mkdirSync(cwd, {recursive: true});
    await box.start({command: 'claude', args: [], cwd, input: 'p', timeoutMs: 5000, graceMs: 100}).result;
    process.env.PATH = path;
    const order = calls.filter(c => c.startsWith('docker cp'));
    expect(order).toEqual(["docker cp '/plugin' 'forger-issue-7-n1:/opt/forger'"]);
    const text = readFileSync(log, 'utf-8');
    expect(text.startsWith('create')).toBe(true);
    expect(text).toContain('FORGER_PLUGIN_ROOT=/opt/forger');
    expect(text.indexOf('create')).toBeLessThan(text.indexOf('start -a -i forger-issue-7-n1'));
  });

  test('the docker sandbox with no devcontainer and no sandbox_image refuses and names both', () => {
    const {box, root} = site(undefined, null);
    const w = box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: join(root, '.forger')});
    expect(w.ok).toBe(false);
    const error = (w as {error: string}).error;
    expect(error).toContain('.devcontainer');
    expect(error).toContain('sandbox_image');
    expect(() => sandboxFor('docker', () => ok(SSH_REMOTE), {projectRoot: root, pluginRoot: '/plugin', baseBranch: 'main'})).toThrow('sandbox_image');
  });

  test('the docker sandbox uses the image named by sandbox_image', () => {
    const {box, calls, root} = site(undefined, 'ghcr.io/acme/mine:2');
    expect(box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: join(root, '.forger')}).ok).toBe(true);
    expect(calls.some(c => c.startsWith('docker build'))).toBe(false);
    expect(imagePlan(null, false, 'ghcr.io/acme/mine:2', 't')).toEqual({kind: 'image', image: 'ghcr.io/acme/mine:2'});
  });

  test('no argument mounts the host', () => {
    const args = runArgs({name: 'n', image: 'img', repoKey: 'k', origin: 'https://x/y', baseBranch: 'main', branch: 'feat/a', command: 'claude', args: [], passthrough: []});
    expect(args.filter(a => a === '-v' || a === '--volume')).toEqual([]);
    for (const a of args.filter(a => a.startsWith('type='))) expect(a).toMatch(/^type=volume,source=forger-cache-/);
    expect(args.filter(a => a !== '/tmp:rw,size=1g').join(' ')).not.toMatch(/ \/tmp|\/home/);
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
  });

  test('a failed image build is reported, not thrown', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-docker-'));
    dirs.push(root);
    mkdirSync(join(root, '.devcontainer'));
    writeFileSync(join(root, '.devcontainer', 'Dockerfile'), 'FROM scratch');
    const box = dockerSandbox(cmd => (cmd.startsWith('docker build') ? {stdout: '', stderr: 'no space', exitCode: 1} : ok('https://x/y.git')), {projectRoot: root, pluginRoot: '/p', baseBranch: 'main'});
    const w = box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: root});
    expect(w).toEqual({ok: false, ticket: 'issue-7', error: expect.stringContaining('no space')});
  });
});

/** A site whose docker is a script, and whose engine-side docker calls are answered by `reply`. */
function limitSite(script: string, reply: (cmd: string) => CommandResult | null, limits?: {memory: string; cpus: number; pids: number; tmp: string}) {
  const root = mkdtempSync(join(tmpdir(), 'forger-docker-'));
  dirs.push(root);
  const calls: string[] = [];
  const git = (cmd: string): CommandResult => {
    calls.push(cmd);
    if (cmd.startsWith('git remote get-url')) return ok(SSH_REMOTE);
    if (cmd.includes('rev-parse --abbrev-ref')) return ok('feat/issue-7');
    return reply(cmd) ?? ok();
  };
  const box = dockerSandbox(git, {projectRoot: root, pluginRoot: '/plugin', baseBranch: 'main', passthrough: [], nonce: () => 'n1', limits, image: 'img:1'});
  const bin = mkdtempSync(join(tmpdir(), 'forger-fakebin-'));
  dirs.push(bin);
  const log = join(bin, 'created');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\nif [ "$1" = create ]; then echo "ARGS $*" >> ${log}; exit 0; fi\n${script}\n`, {mode: 0o755});
  const cwd = join(root, '.forger', 'worktrees', 'issue-7');
  mkdirSync(cwd, {recursive: true});
  const start = async (graceMs: number, timeoutMs: number) => {
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      return await box.start({command: 'claude', args: [], cwd, input: 'p', timeoutMs, graceMs}).result;
    } finally {
      process.env.PATH = path;
    }
  };
  const created = () => (existsSync(log) ? readFileSync(log, 'utf-8') : '');
  return {calls, start, created};
}

describe('the docker sandbox limits', () => {
  test('the docker sandbox applies the configured memory, CPU, process and tmp limits', async () => {
    const {start, created} = limitSite('true', () => null, {memory: '2g', cpus: 1.5, pids: 100, tmp: '256m'});
    await start(100, 5000);
    const args = created();
    expect(args).toContain('--memory 2g --memory-swap 2g');
    expect(args).toContain('--cpus 1.5');
    expect(args).toContain('--pids-limit 100');
    expect(args).toContain('--tmpfs /tmp:rw,size=256m');
  });

  test('a run past its deadline stops the container after the grace period and logs both', async () => {
    const {calls, start} = limitSite('sleep 30', () => null);
    const done = await start(100, 200);
    expect(done.timedOut).toBe(true);
    expect(done.output).toContain("forger: stopped container forger-issue-7-n1 after the 0s grace period");
    expect(done.output).toContain('forger: removed container forger-issue-7-n1');
    expect(calls.indexOf("docker stop -t 0 'forger-issue-7-n1'")).toBeGreaterThan(-1);
    expect(calls.indexOf("docker stop -t 0 'forger-issue-7-n1'")).toBeLessThan(calls.indexOf("docker rm -f 'forger-issue-7-n1'"));
  });

  test('a run killed for memory is an infrastructure error that names the limit', async () => {
    const {start} = limitSite('echo working; exit 137', cmd => (cmd.startsWith('docker inspect') ? ok('true\n') : null), {memory: '2g', cpus: 2, pids: 512, tmp: '1g'});
    const done = await start(100, 5000);
    expect(done.exitCode).toBe(137);
    const exit = classifyExit(done.exitCode, done.output, done.timedOut);
    expect(exit.kind).toBe('infrastructure');
    expect(exit.kind === 'infrastructure' && exit.reason).toContain('memory 2g');
  });

  test('a failed run that was not out of memory stays a worker failure', async () => {
    const {start} = limitSite('exit 1', cmd => (cmd.startsWith('docker inspect') ? ok('false\n') : null));
    const done = await start(100, 5000);
    expect(classifyExit(done.exitCode, done.output, done.timedOut).kind).toBe('worker');
  });
});

describe('the docker plan', () => {
  test('picks an image, a build, the Dockerfile beside it, the configured image, or none', () => {
    expect(imagePlan({dir: '.devcontainer', text: '{"image":"x:1"}'}, false, null, 't')).toEqual({kind: 'image', image: 'x:1'});
    expect(imagePlan({dir: '.devcontainer', text: '{"build":{"dockerfile":"../Dockerfile"}}'}, false, null, 't')).toEqual({kind: 'build', tag: 't', dockerfile: 'Dockerfile', context: '.devcontainer'});
    expect(imagePlan(null, true, null, 't')).toEqual({kind: 'build', tag: 't', dockerfile: '.devcontainer/Dockerfile', context: '.devcontainer'});
    expect(imagePlan({dir: '', text: 'not json'}, false, 'mine', 't')).toEqual({kind: 'image', image: 'mine'});
    expect(imagePlan(null, false, null, 't')).toEqual({kind: 'none'});
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
