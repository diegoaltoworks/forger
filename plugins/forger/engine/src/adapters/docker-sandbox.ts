/**
 * The `docker` sandbox: one container per worker, started from the repository's
 * image. The container clones origin at the base branch and pushes the ticket
 * branch; nothing of the host is mounted. The host keeps the git worktree
 * only as the engine's anchor for the ticket, and never shares it. Outcomes
 * come back through the tracker and git, so the engine reads no file in the
 * container.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {CapturingRunner, Sandbox, SupervisedResult} from '../ports';
import {ticketBranch, worktreeWorkspace} from '../loop';
import {CREDENTIAL_VARIABLES, containerName, imagePlan, repoKey, runArgs, runEnv, type DevcontainerFile, type ImagePlan} from './docker-plan';
import {runSupervised} from './supervise';

export interface DockerSandboxOptions {
  projectRoot: string;
  pluginRoot: string;
  baseBranch: string;
  /** Names of the variables passed to the container; the harnesses' credentials by default. */
  passthrough?: string[];
  nonce?: () => string;
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function readDevcontainer(root: string): {file: DevcontainerFile | null; dockerfile: boolean} {
  const inDir = join(root, '.devcontainer', 'devcontainer.json');
  const flat = join(root, '.devcontainer.json');
  const file = existsSync(inDir) ? {dir: '.devcontainer', text: readFileSync(inDir, 'utf-8')} : existsSync(flat) ? {dir: '', text: readFileSync(flat, 'utf-8')} : null;
  return {file, dockerfile: existsSync(join(root, '.devcontainer', 'Dockerfile'))};
}

export function dockerSandbox(git: CapturingRunner, options: DockerSandboxOptions): Sandbox {
  const {projectRoot, pluginRoot, baseBranch} = options;
  const workspace = worktreeWorkspace(git);
  const passthrough = options.passthrough ?? CREDENTIAL_VARIABLES.filter(v => process.env[v] !== undefined);
  const nonce = options.nonce ?? (() => Math.random().toString(36).slice(2, 8));
  let origin: string | null = null;
  let prepared: {image: string} | {error: string} | null = null;

  const originUrl = (): string => (origin ??= git('git remote get-url origin').stdout);

  function ensureImage(): {image: string} | {error: string} {
    if (prepared) return prepared;
    const url = originUrl();
    if (url === '') return (prepared = {error: 'the repository has no origin remote for the container to clone'});
    const found = readDevcontainer(projectRoot);
    const key = repoKey(url);
    const plan: ImagePlan = imagePlan(
      found.file,
      found.dockerfile,
      {tag: 'forger-sandbox:base', dockerfile: join(pluginRoot, 'sandbox', 'Dockerfile'), context: join(pluginRoot, 'sandbox')},
      `forger-sandbox:${key}`
    );
    if (plan.kind === 'image') return (prepared = {image: plan.image});
    const context = plan.context.startsWith('/') ? plan.context : join(projectRoot, plan.context);
    const dockerfile = plan.dockerfile.startsWith('/') ? plan.dockerfile : join(projectRoot, plan.dockerfile);
    const built = git(`docker build -q -t ${quote(plan.tag)} -f ${quote(dockerfile)} ${quote(context)}`);
    if (built.exitCode !== 0) return (prepared = {error: `docker build of ${plan.tag} failed: ${built.stderr || built.stdout}`});
    return (prepared = {image: plan.tag});
  }

  return {
    id: 'docker',
    prepare(request) {
      const image = ensureImage();
      if ('error' in image) return {ok: false, ticket: request.ticket, error: image.error};
      return workspace.prepare(request);
    },
    cleanup: workspace.cleanup,
    start(spec) {
      const own = new AbortController();
      const abort = spec.abort ? AbortSignal.any([spec.abort, own.signal]) : own.signal;
      const image = ensureImage();
      if ('error' in image) {
        const failed: SupervisedResult = {exitCode: 1, signal: null, output: image.error, timedOut: false};
        return {result: Promise.resolve(failed), end: () => own.abort()};
      }
      const url = originUrl();
      const head = git(`git -C ${quote(spec.cwd)} rev-parse --abbrev-ref HEAD`).stdout;
      const ticketFromPath = spec.cwd.split('/').pop() ?? 'worker';
      const branch = head !== '' && head !== 'HEAD' ? head : ticketBranch(ticketFromPath);
      const name = containerName(ticketFromPath, nonce());
      const input = {name, image: image.image, repoKey: repoKey(url), origin: url, baseBranch, branch, command: spec.command, args: spec.args, passthrough};
      const remove = () => void git(`docker rm -f ${quote(name)}`);
      const result = runSupervised({
        ...spec,
        command: 'docker',
        args: runArgs(input),
        env: runEnv(input, spec.env),
        abort,
      }).finally(remove);
      return {
        result,
        end: () => {
          own.abort();
          remove();
        },
      };
    },
  };
}
