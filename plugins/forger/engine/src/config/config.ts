/**
 * Work-loop configuration. Everything project-specific lives in the consumer
 * repo's `.forger/workloop.config.json`; this module defines the shape, the
 * defaults, and the merge. `mergeConfig` is pure and is where the tests live;
 * `loadConfig` is the thin I/O wrapper around it.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {CONFIG_FILE, FORGER_DIR, detectLayout, toPhysical} from './layout';

export interface Tier {
  /** A role (`fast`, `standard`, `deep`, or one the project defines in `models`) or a literal model id. */
  model: string;
  budget: number;
}

/** What a model costs, in USD per million tokens, for a harness that reports tokens and not cost. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Cached input tokens; defaults to `input`. */
  cached_input?: number;
}

export type CredentialKind = 'api_key' | 'subscription';

/** A skill slot maps to an installed skill name, or to a SKILL.md the worker reads and follows. */
export type SkillMapping = string | {file: string};

export interface SandboxLimits {
  memory: string;
  cpus: number;
  pids: number;
  tmp: string;
}

export interface WorkloopConfig {
  /** Only tickets with this `repo` (or no `repo`) are worked here. null = no filter. */
  repo: string | null;
  /** Slash command the runner invokes per iteration (no leading slash). */
  worker_command: string;
  /** Quality-gate command the worker runs; surfaced to the agent, not run here. */
  gates: string;
  /** Branch an iteration must land on; verifyMerged() checks HEAD against it. */
  base_branch: string;
  /** Role -> the model id the agent adapter is given. A tier naming anything else is taken as a model id. */
  models: Record<string, string>;
  model_by_priority: {P0: Tier; default: Tier; [k: string]: Tier};
  /** Model id -> price, so a harness that reports tokens only can enforce the budget. Default none: such a run has no spend limit. */
  model_prices: Record<string, ModelPrice>;
  effort_multiplier: Record<string, number>;
  /**
   * The tier the verifier runs on (ADR 0010). null picks one other than the
   * default worker tier from `model_by_priority`, so it does not share the
   * worker's blind spots.
   */
  verifier: Tier | null;
  /**
   * What the engine runs in the verifier's throwaway copy of the PR head before the model starts.
   * `setup` is a shell command; "" runs nothing; null uses the install step of `gates` (the leading
   * `cd` and install segments), else the frozen install for a lockfile at the root of the copy.
   */
  verify: {setup: string | null};
  limits: {
    timeoutMinutes: number;
    /** Seconds between SIGTERM and SIGKILL to the worker's process group on timeout. */
    killGraceSeconds: number;
    maxConsecutiveFailures: number;
    pauseBetweenIterations: number;
    pauseAfterFailure: number;
    maxStallIterations: number;
    /** Declined picks in a row that halt the loop. */
    maxConsecutiveDeclines: number;
    /** Tickets set aside in a row, with no merge between them, that halt the loop. */
    maxSetAside: number;
    /** Verifier rounds per PR before the ticket is handed to the owner (ADR 0010). */
    maxVerifyRounds: number;
    /** Seconds `verify` and `merge` wait for the engine's uncommitted changes to go before they refuse. */
    engineChangedWaitSeconds: number;
  };
  /**
   * Workers the loop runs at once (ADR 0011). 1 is the single-worker loop; a
   * higher number runs tickets side by side in their own worktrees, as far as
   * the scheduling rule says they are safe together. A positive integer.
   */
  parallelism: number;
  /** The harness that runs the worker: `claude` (default), `opencode`, `codex` or `copilot`. */
  harness: string;
  /** Run with a harness that cannot refuse a tool call (see docs/reference/adapters.md); off by default. */
  allow_unguarded: boolean;
  /** Where workers run: `host` (default), a worktree on this machine. */
  sandbox: string;
  /**
   * The image of the `docker` sandbox when the repository has no `.devcontainer/` image. Forger ships none:
   * the image is the project's own and must meet the image contract (`check sandbox`).
   */
  sandbox_image: string | null;
  /** The image `run --detach` starts the engine in under the `docker` sandbox: the contract plus the `docker` CLI. */
  sandbox_engine_image: string | null;
  /**
   * Per-run limits a container sandbox applies: `memory` and `tmp` take a docker size such as `4g`,
   * `cpus` is a number of CPUs, `pids` the most processes.
   */
  sandbox_limits: SandboxLimits;
  /**
   * What a sandboxed run is given (ADR 0019). `github` names where the one repository-scoped token
   * comes from: `env` reads the variable `variable` (a read-only run, the verifier's, reads `read_variable` and never the write token); `app` mints an installation token per run from the
   * GitHub App whose id and private key sit in the two named variables. `model` names, per harness id,
   * which kind of model credential to pass: an `api_key` or a `subscription` token.
   */
  credentials: {
    github: {source: 'env' | 'app'; variable: string; read_variable: string; app_id_variable: string; app_key_variable: string};
    model: Record<string, CredentialKind>;
  };
  paths: {
    backlog: string;
    state: string;
    log: string;
    output: string;
    halt: string;
    /** Holds the pid of the one live runner. */
    lock: string;
    /** Append-only JSON lines, one per terminal event. */
    events: string;
    /** The worker's decline of the engine's pick, read once by the iteration that asked for it. */
    declined: string;
    /** The project's rules and gotchas, which the worker is told to follow. */
    process: string;
    /** One verdict record per verified PR head commit. */
    verdicts: string;
    /** One JSON line per opinion per `check` run inside a worker; local, never committed. */
    checks: string;
    /** The disposable checkouts `verify` and `critique` make; removed when each finishes. */
    tmp: string;
  };
  /**
   * Where the backlog lives. `github`: issues carrying the intake `label`
   * are the tickets, and an issue closed by a merged PR is completed (ADR
   * 0001). `local` and `none` read backlog.json; `none` also keeps the worker
   * off any tracker. `ignore` lists labels whose issues are not work - a
   * trailing `*` matches a prefix, as in `wayfinder:*`.
   */
  tracker: {kind: 'github' | 'local' | 'none'; label: string; ignore: string[]};
  /** What `check ticket` holds acceptance criteria to; `subjective_words` extends the built-in list. */
  criteria: {subjective_words: string[]};
  /**
   * Path globs of the files that hold guarantees (thresholds, budgets, baselines, layout floors).
   * `facts --guards` lists them; null uses the coverage baseline and the approved-baselines
   * manifest of the packs that are installed.
   */
  guards: string[] | null;
  /**
   * Where the machine-written loop files live (ADR 0015). `local` keeps them
   * beside the engine; `branch` keeps them on the `branch` of the remote and
   * makes the engine hold the lease while it runs.
   */
  state: {home: 'local' | 'branch'; branch: string};
  /**
   * Paths that stay modified in a checkout without being the worker's doing
   * (local settings, a work order). The dirty-tree check skips them, along
   * with the files the engine owns (`paths`). A directory covers what is under it.
   */
  local_only: string[];
  /**
   * Skill slot -> installed skill name, or `{file}` naming a SKILL.md (absolute, or
   * relative to an installed collection's root or the forger plugin root). An unmapped slot, or a skill that is not
   * installed, uses forger's built-in step. `skills --json` resolves it.
   */
  skills: Record<string, SkillMapping>;
  /**
   * The flavour that picks a skill per slot: `"<name>"` or `"<name>@<version>"`, looked up in
   * `.forger/flavours/` then the plugin's. The `skills` map wins per slot. `default` is forger's built-ins.
   */
  flavour: string;
  /**
   * Model and vendor names the `docs` check flags in prose, matched as whole
   * words, case-insensitively. Prose names roles; adapters and config name models.
   */
  model_names: string[];
}

/**
 * What a consumer's workloop.config.json may contain: every field optional, and
 * nested sections may be partial (override just `limits.timeoutMinutes` and keep
 * the rest). mergeConfig fills the gaps from the defaults.
 */
export interface WorkloopConfigInput {
  repo?: string | null;
  worker_command?: string;
  gates?: string;
  base_branch?: string;
  models?: Record<string, string>;
  model_by_priority?: Record<string, Tier>;
  model_prices?: Record<string, ModelPrice>;
  effort_multiplier?: Record<string, number>;
  verifier?: Tier | null;
  verify?: Partial<WorkloopConfig['verify']>;
  harness?: string;
  allow_unguarded?: boolean;
  sandbox?: string;
  sandbox_image?: string | null;
  sandbox_engine_image?: string | null;
  sandbox_limits?: Partial<SandboxLimits>;
  credentials?: {github?: Partial<WorkloopConfig['credentials']['github']>; model?: Record<string, CredentialKind>};
  parallelism?: number;
  limits?: Partial<WorkloopConfig['limits']>;
  paths?: Partial<WorkloopConfig['paths']>;
  tracker?: Partial<WorkloopConfig['tracker']>;
  criteria?: Partial<WorkloopConfig['criteria']>;
  guards?: string[] | null;
  state?: Partial<WorkloopConfig['state']>;
  local_only?: string[];
  skills?: Record<string, SkillMapping>;
  flavour?: string;
  model_names?: string[];
}

/** The model a role stands for; a name that is not a role is already a model id. Pure. */
export function resolveModel(role: string, models: Record<string, string>): string {
  return Object.prototype.hasOwnProperty.call(models, role) ? models[role] : role;
}

export const DEFAULT_CONFIG: WorkloopConfig = {
  repo: null,
  worker_command: 'forger:auto-ticket',
  gates: '',
  base_branch: 'main',
  harness: 'claude',
  allow_unguarded: false,
  sandbox: 'host',
  sandbox_image: null,
  sandbox_engine_image: null,
  sandbox_limits: {memory: '4g', cpus: 2, pids: 512, tmp: '1g'},
  credentials: {
    github: {source: 'env', variable: 'GH_TOKEN', read_variable: 'GH_READ_TOKEN', app_id_variable: 'FORGER_APP_ID', app_key_variable: 'FORGER_APP_PRIVATE_KEY'},
    model: {},
  },
  parallelism: 1,
  /**
   * P0 is the foundation. A subtle error there is both expensive and invisible,
   * so those tickets get the stronger model and a wider budget. A cap that
   * stops a ticket finishing costs more than the headroom it saves: the agent
   * commits, then dies before pushing/merging, leaving the backlog claiming
   * work that only exists on a local branch.
   */
  models: {fast: 'haiku', standard: 'sonnet', deep: 'opus'},
  model_by_priority: {
    P0: {model: 'deep', budget: 22.5},
    default: {model: 'standard', budget: 18.0},
  },
  model_prices: {},
  verifier: null,
  verify: {setup: null},
  /** Budget multiplier by declared effort; a truncated large ticket is worst. */
  effort_multiplier: {
    small: 1,
    medium: 1.5,
    large: 2.5,
  },
  limits: {
    timeoutMinutes: 45,
    killGraceSeconds: 30,
    maxConsecutiveFailures: 3,
    pauseBetweenIterations: 5000,
    pauseAfterFailure: 10000,
    maxStallIterations: 5,
    maxConsecutiveDeclines: 3,
    maxSetAside: 3,
    maxVerifyRounds: 2,
    engineChangedWaitSeconds: 180,
  },
  paths: {
    backlog: `${FORGER_DIR}/backlog.json`,
    state: `${FORGER_DIR}/state.json`,
    log: `${FORGER_DIR}/work.log`,
    output: `${FORGER_DIR}/output`,
    halt: `${FORGER_DIR}/HALT`,
    lock: `${FORGER_DIR}/runner.lock`,
    events: `${FORGER_DIR}/events.jsonl`,
    declined: `${FORGER_DIR}/declined.json`,
    process: `${FORGER_DIR}/process.md`,
    verdicts: `${FORGER_DIR}/verdicts`,
    checks: `${FORGER_DIR}/checks.jsonl`,
    tmp: `${FORGER_DIR}/tmp`,
  },
  tracker: {kind: 'github', label: 'ready-for-agent', ignore: []},
  criteria: {subjective_words: []},
  guards: null,
  state: {home: 'local', branch: 'forger-state'},
  local_only: [],
  skills: {},
  flavour: 'default',
  model_names: ['claude', 'anthropic', 'opus', 'sonnet', 'haiku', 'gpt', 'openai', 'gemini', 'llama', 'mistral'],
};

/** A worker count the loop can honour: a whole number of at least one. Pure. */
export function validParallelism(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

/** A state setting the loop can honour: a known home and a usable branch name. Throws otherwise. Pure. */
export function validateState(state: WorkloopConfig['state']): void {
  if (state.home !== 'local' && state.home !== 'branch') {
    throw new Error(`state.home must be "local" or "branch", got ${JSON.stringify(state.home)}`);
  }
  if (typeof state.branch !== 'string' || !/^[A-Za-z0-9._\/-]+$/.test(state.branch) || state.branch.startsWith('-')) {
    throw new Error(`state.branch must be a branch name, got ${JSON.stringify(state.branch)}`);
  }
}

/** Credential settings the run can honour: a known GitHub source and a known kind per harness. Throws otherwise. Pure. */
export function validateCredentials(c: WorkloopConfig['credentials']): void {
  if (c.github.source !== 'env' && c.github.source !== 'app') {
    throw new Error(`credentials.github.source must be "env" or "app", got ${JSON.stringify(c.github.source)}`);
  }
  for (const [harness, kind] of Object.entries(c.model)) {
    if (kind !== 'api_key' && kind !== 'subscription') {
      throw new Error(`credentials.model.${harness} must be "api_key" or "subscription", got ${JSON.stringify(kind)}`);
    }
  }
}

const SIZE = /^[1-9][0-9]*[bkmg]?$/i;

function validateSandboxLimits(l: SandboxLimits): void {
  if (typeof l.memory !== 'string' || !SIZE.test(l.memory)) throw new Error(`sandbox_limits.memory must be a size such as "4g", got ${JSON.stringify(l.memory)}`);
  if (typeof l.tmp !== 'string' || !SIZE.test(l.tmp)) throw new Error(`sandbox_limits.tmp must be a size such as "1g", got ${JSON.stringify(l.tmp)}`);
  if (typeof l.cpus !== 'number' || !(l.cpus > 0)) throw new Error(`sandbox_limits.cpus must be a positive number, got ${JSON.stringify(l.cpus)}`);
  if (!Number.isInteger(l.pids) || l.pids < 1) throw new Error(`sandbox_limits.pids must be a positive integer, got ${JSON.stringify(l.pids)}`);
}

/**
 * Merge a partial user config over a base, one level deep for each nested
 * section so a user who overrides only `limits.timeoutMinutes` keeps every
 * other default. Pure - no I/O - so the merge logic is unit-testable.
 */
export function mergeConfig(
  user: WorkloopConfigInput,
  base: WorkloopConfig = DEFAULT_CONFIG
): WorkloopConfig {
  if (user.parallelism !== undefined && !validParallelism(user.parallelism)) {
    throw new Error(`parallelism must be a positive integer, got ${JSON.stringify(user.parallelism)}`);
  }
  const state = {...base.state, ...(user.state ?? {})};
  validateState(state);
  const credentials = {
    github: {...base.credentials.github, ...(user.credentials?.github ?? {})},
    model: {...base.credentials.model, ...(user.credentials?.model ?? {})},
  };
  validateCredentials(credentials);
  const sandboxLimits = {...base.sandbox_limits, ...(user.sandbox_limits ?? {})};
  validateSandboxLimits(sandboxLimits);
  return {
    ...base,
    ...user,
    state,
    credentials,
    models: {...base.models, ...(user.models ?? {})},
    model_prices: {...base.model_prices, ...(user.model_prices ?? {})},
    model_by_priority: {
      ...base.model_by_priority,
      ...(user.model_by_priority ?? {}),
    } as WorkloopConfig['model_by_priority'],
    effort_multiplier: {
      ...base.effort_multiplier,
      ...(user.effort_multiplier ?? {}),
    },
    verify: {...base.verify, ...(user.verify ?? {})},
    sandbox_limits: sandboxLimits,
    limits: {...base.limits, ...(user.limits ?? {})},
    paths: {...base.paths, ...(user.paths ?? {})},
    tracker: {...base.tracker, ...(user.tracker ?? {})},
    criteria: {...base.criteria, ...(user.criteria ?? {})},
    guards: user.guards ?? base.guards,
    skills: {...base.skills, ...(user.skills ?? {})},
    model_names: user.model_names ?? base.model_names,
  };
}

/** Resolves every configured path to where this project keeps it (the legacy folder, until migrated). */
export function resolvePaths(config: WorkloopConfig, projectRoot: string): WorkloopConfig {
  const layout = detectLayout(projectRoot);
  const paths = Object.fromEntries(Object.entries(config.paths).map(([k, v]) => [k, toPhysical(layout, v)])) as WorkloopConfig['paths'];
  return {...config, paths};
}

/** Read the project's `workloop.config.json`, merge it over the defaults, and resolve its paths. */
export function loadConfig(projectRoot: string): WorkloopConfig {
  const layout = detectLayout(projectRoot);
  const file = join(projectRoot, layout.dir, CONFIG_FILE);
  if (!existsSync(file)) return resolvePaths(mergeConfig({}), projectRoot);
  let user: WorkloopConfigInput;
  try {
    user = JSON.parse(readFileSync(file, 'utf-8')) as WorkloopConfigInput;
  } catch (e) {
    throw new Error(`Invalid ${layout.dir}/${CONFIG_FILE}: ${(e as Error).message}`);
  }
  return resolvePaths(mergeConfig(user), projectRoot);
}
