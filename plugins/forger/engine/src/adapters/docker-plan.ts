/**
 * The pure half of the `docker` sandbox: which image a repository runs in and
 * the arguments of the one `docker run` per worker. Nothing here touches
 * docker, the disk or the environment.
 */

export type ImagePlan =
  | {kind: 'image'; image: string}
  | {kind: 'build'; tag: string; dockerfile: string; context: string};

export interface DevcontainerFile {
  /** The folder holding the file, relative to the repository root ('' for `.devcontainer.json`). */
  dir: string;
  text: string;
}

export interface BaseImage {
  tag: string;
  dockerfile: string;
  context: string;
}

/** Strips JSONC comments and trailing commas; string contents are left alone. */
export function parseJsonc(text: string): unknown {
  const bare = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, m => (m.startsWith('"') ? m : ''));
  const noTrailing = bare.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail?: string) => (m.startsWith('"') ? m : (tail ?? '')));
  return JSON.parse(noTrailing);
}

function joinPath(dir: string, rel: string): string {
  const parts = `${dir}/${rel}`.split('/').filter(p => p !== '' && p !== '.');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/') || '.';
}

/**
 * The repository's own image when `.devcontainer/` describes one (an `image`, or
 * a `build` with a Dockerfile), else forger's base image for the stack.
 */
export function imagePlan(devcontainer: DevcontainerFile | null, dockerfileInDevcontainerDir: boolean, base: BaseImage, ownTag: string): ImagePlan {
  if (devcontainer) {
    try {
      const parsed = parseJsonc(devcontainer.text) as {image?: unknown; build?: {dockerfile?: unknown; context?: unknown}; dockerFile?: unknown; context?: unknown};
      if (typeof parsed.image === 'string' && parsed.image !== '') return {kind: 'image', image: parsed.image};
      const dockerfile = parsed.build?.dockerfile ?? parsed.dockerFile;
      const context = parsed.build?.context ?? parsed.context;
      if (typeof dockerfile === 'string') {
        return {kind: 'build', tag: ownTag, dockerfile: joinPath(devcontainer.dir, dockerfile), context: joinPath(devcontainer.dir, typeof context === 'string' ? context : '.')};
      }
    } catch {
      // An unreadable file falls through to the Dockerfile beside it, then to the base image.
    }
  }
  if (dockerfileInDevcontainerDir) return {kind: 'build', tag: ownTag, dockerfile: '.devcontainer/Dockerfile', context: '.devcontainer'};
  return {kind: 'build', ...base};
}

/** An ssh remote has no key in the container, so it is cloned over https. */
export function cloneUrl(origin: string): string {
  const scp = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(origin.trim());
  return scp ? `https://${scp[1]}/${scp[2]}` : origin.trim();
}

/** Variables the container receives by name only, so no secret lands in a command line. */
export const CREDENTIAL_VARIABLES = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];

export const CACHES = [
  {name: 'bun', path: '/cache/bun', env: 'BUN_INSTALL_CACHE_DIR'},
  {name: 'uv', path: '/cache/uv', env: 'UV_CACHE_DIR'},
  {name: 'npm', path: '/cache/npm', env: 'npm_config_cache'},
];

export const WORKDIR = '/work';

export function cacheVolume(repoKey: string, name: string): string {
  return `forger-cache-${repoKey}-${name}`;
}

/** A short, docker-safe key for one repository, from its origin url. */
export function repoKey(origin: string): string {
  const slug = cloneUrl(origin).replace(/^https?:\/\//, '').replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug.slice(-48) || 'repo';
}

export interface ContainerLimits {
  memory: string;
  cpus: number;
  pids: number;
  tmp: string;
}

export const DEFAULT_LIMITS: ContainerLimits = {memory: '4g', cpus: 2, pids: 512, tmp: '1g'};

/** The `docker run` flags for the limits. Swap is capped with memory, so the memory limit is a real one. */
export function limitArgs(l: ContainerLimits): string[] {
  return ['--memory', l.memory, '--memory-swap', l.memory, '--cpus', String(l.cpus), '--pids-limit', String(l.pids), '--tmpfs', `/tmp:rw,size=${l.tmp}`];
}

export interface RunInput {
  name: string;
  image: string;
  repoKey: string;
  origin: string;
  baseBranch: string;
  branch: string;
  command: string;
  args: string[];
  /** Names of variables to pass through from the process that starts docker. */
  passthrough: string[];
  /** A ref of origin to check out detached, instead of the ticket branch. */
  ref?: string;
  limits?: ContainerLimits;
}

const SCRIPT = [
  'set -e',
  'git clone --quiet --branch "$FORGER_BASE" "$FORGER_ORIGIN" ' + WORKDIR,
  'cd ' + WORKDIR,
  'if [ -n "${FORGER_REF:-}" ]; then git fetch --quiet origin "$FORGER_REF" && git checkout -q --detach FETCH_HEAD;',
  'else git checkout -q -B "$FORGER_BRANCH" "origin/$FORGER_BRANCH" 2>/dev/null || git checkout -q -B "$FORGER_BRANCH"; fi',
  'if command -v gh >/dev/null 2>&1 && [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then gh auth setup-git; fi',
  'exec "$@"',
].join('\n');

/** The `docker run` arguments: the image, the limits, the clone, the caches, and no mount of the host. */
export function runArgs(input: RunInput): string[] {
  const env = [...new Set([...input.passthrough, 'FORGER_BASE', 'FORGER_ORIGIN', 'FORGER_BRANCH', ...(input.ref ? ['FORGER_REF'] : []), ...CACHES.map(c => c.env)])];
  return [
    'run',
    '-i',
    '--name',
    input.name,
    '--security-opt',
    'no-new-privileges',
    ...limitArgs(input.limits ?? DEFAULT_LIMITS),
    '-w',
    WORKDIR,
    ...CACHES.flatMap(c => ['--mount', `type=volume,source=${cacheVolume(input.repoKey, c.name)},target=${c.path}`]),
    ...env.flatMap(v => ['-e', v]),
    input.image,
    'sh',
    '-c',
    SCRIPT,
    'forger-worker',
    input.command,
    ...input.args,
  ];
}

/** The environment the docker client is started with, so `-e NAME` has a value to pass on. */
export function runEnv(input: Pick<RunInput, 'origin' | 'baseBranch' | 'branch' | 'ref'>, extra: Record<string, string> | undefined): Record<string, string> {
  return {
    ...(extra ?? {}),
    FORGER_BASE: input.baseBranch,
    FORGER_ORIGIN: cloneUrl(input.origin),
    FORGER_BRANCH: input.branch,
    ...(input.ref ? {FORGER_REF: input.ref} : {}),
    ...Object.fromEntries(CACHES.map(c => [c.env, c.path])),
  };
}

export function containerName(ticket: string, nonce: string): string {
  return `forger-${ticket.replace(/[^A-Za-z0-9_.-]/g, '-')}-${nonce}`;
}

export interface DockerCheck {
  ok: boolean;
  /** What to do, when it is not ok. */
  fix: string[];
}

/** Reads the outcome of `docker info`: reachable, or why not and the fix. */
export function dockerCheck(result: {exitCode: number; stderr: string}): DockerCheck {
  if (result.exitCode === 0) return {ok: true, fix: []};
  const err = result.stderr.toLowerCase();
  if (err.includes('permission denied')) {
    return {ok: false, fix: ['the Docker API socket refused this user: add the user to the docker group and sign in again, or run Docker in rootless mode']};
  }
  if (err.includes('command not found') || err.includes('not found') || (err.includes('no such file') && !err.includes('socket'))) {
    return {ok: false, fix: ['install Docker, or Podman with its Docker-compatible API, and put `docker` on the PATH']};
  }
  return {
    ok: false,
    fix: [
      'the Docker API is not reachable: start the Docker daemon',
      'on a rootless install, run `systemctl --user start docker` and point the client at its socket with `export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock`',
    ],
  };
}

/** The marker line the infrastructure classifier reads when a container hit a limit. */
export function limitMarker(limit: 'memory', value: string): string {
  return `forger: sandbox limit exceeded (${limit} ${value}): the container was killed for it`;
}
