/**
 * How a detached engine is started, as pure plans over facts a tool gathered:
 * a container with a restart policy under the docker sandbox, a new session
 * otherwise. The command runs the plan and records how the engine was started.
 */

import {CACHES, cacheVolume, cloneUrl, repoKey} from './docker-plan';

export type EngineStart = {mode: 'container'; name: string; image: string} | {mode: 'session'; pid: number};

export interface DetachInputs {
  sandbox: string;
  dockerUp: boolean;
  origin: string;
  baseBranch: string;
  image: string;
  /** Names of variables passed to the container by name only, so no secret lands in a command line. */
  passthrough: string[];
  /** Where the docker API is reachable from a container. */
  socket?: string;
}

export type DetachPlan =
  | {kind: 'container'; name: string; image: string; args: string[]}
  | {kind: 'session'; reason: string}
  | {kind: 'refused'; reason: string};

export const ENGINE_WORKDIR = '/engine';

/** The engine container's name: one per repository, so a second start finds the first. */
export function engineName(origin: string): string {
  return `forger-engine-${repoKey(origin)}`;
}

const ENGINE_SCRIPT = [
  'set -e',
  'git clone --quiet --branch "$FORGER_BASE" "$FORGER_ORIGIN" ' + ENGINE_WORKDIR,
  'cd ' + ENGINE_WORKDIR,
  'if command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then gh auth setup-git; fi',
  'exec bun "$FORGER_PLUGIN_ROOT/bin/work.ts" run --continuous',
].join('\n');

/**
 * The host sandbox detaches into a new session. The docker sandbox needs a
 * reachable Docker API: without it the engine could not start a worker, so the
 * start is refused rather than quietly run on the host.
 */
export function planDetach(i: DetachInputs): DetachPlan {
  if (i.sandbox !== 'docker') {
    return {kind: 'session', reason: i.dockerUp ? 'the sandbox is host' : 'the sandbox is host and Docker is not reachable'};
  }
  if (!i.dockerUp) return {kind: 'refused', reason: 'the sandbox is docker but the Docker API is not reachable, so no worker could start; start Docker or set the sandbox to host'};
  if (i.origin.trim() === '') return {kind: 'refused', reason: 'the repository has no origin remote for the engine container to clone'};
  const name = engineName(i.origin);
  const socket = i.socket ?? '/var/run/docker.sock';
  const literal = [`FORGER_BASE=${i.baseBranch}`, `FORGER_ORIGIN=${cloneUrl(i.origin)}`, ...CACHES.map(c => `${c.env}=${c.path}`)];
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '--restart',
    'unless-stopped',
    '--security-opt',
    'no-new-privileges',
    '--mount',
    `type=bind,source=${socket},target=/var/run/docker.sock`,
    ...CACHES.flatMap(c => ['--mount', `type=volume,source=${cacheVolume(repoKey(i.origin), c.name)},target=${c.path}`]),
    ...[...i.passthrough, ...literal].flatMap(v => ['-e', v]),
    '-w',
    ENGINE_WORKDIR,
    i.image,
    'sh',
    '-c',
    ENGINE_SCRIPT,
    'forger-engine',
  ];
  return {kind: 'container', name, image: i.image, args};
}

export function parseEngineStart(text: string | null): EngineStart | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as Partial<{mode: string; name: string; image: string; pid: number}>;
    if (v.mode === 'container' && typeof v.name === 'string' && typeof v.image === 'string') return {mode: 'container', name: v.name, image: v.image};
    if (v.mode === 'session' && typeof v.pid === 'number') return {mode: 'session', pid: v.pid};
  } catch {
    // An unreadable record means the start is not known.
  }
  return null;
}

export function describeStart(s: EngineStart | null): string {
  if (!s) return 'not started with --detach';
  return s.mode === 'container' ? `detached in container ${s.name} (restarts unless stopped)` : `detached in its own session, pid ${s.pid}`;
}
