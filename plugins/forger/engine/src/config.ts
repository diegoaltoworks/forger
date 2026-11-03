/**
 * Work-loop configuration. Everything project-specific lives in the consumer
 * repo's `.claude/workloop.config.json`; this module defines the shape, the
 * defaults, and the merge. `mergeConfig` is pure and is where the tests live;
 * `loadConfig` is the thin I/O wrapper around it.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

export interface Tier {
  model: string;
  budget: number;
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
  model_by_priority: {P0: Tier; default: Tier; [k: string]: Tier};
  effort_multiplier: Record<string, number>;
  limits: {
    timeoutMinutes: number;
    /** Seconds between SIGTERM and SIGKILL to the worker's process group on timeout. */
    killGraceSeconds: number;
    maxConsecutiveFailures: number;
    pauseBetweenIterations: number;
    pauseAfterFailure: number;
    maxStallIterations: number;
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
  };
  /**
   * Where the backlog lives. `github`: issues carrying the intake `label`
   * are the tickets, and an issue closed by a merged PR is completed (ADR
   * 0001). `local` and `none` read backlog.json; `none` also keeps the worker
   * off any tracker. `ignore` lists labels whose issues are not work - a
   * trailing `*` matches a prefix, as in `wayfinder:*`.
   */
  tracker: {kind: 'github' | 'local' | 'none'; label: string; ignore: string[]};
  /**
   * Paths that stay modified in a checkout without being the worker's doing
   * (local settings, a work order). The dirty-tree check skips them, along
   * with the files the engine owns (`paths`). A directory covers what is under it.
   */
  local_only: string[];
  /**
   * Skill slot -> installed skill name. An unmapped slot, or a skill that is not
   * installed, uses forger's built-in step. `skills --json` resolves it.
   */
  skills: Record<string, string>;
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
  model_by_priority?: Record<string, Tier>;
  effort_multiplier?: Record<string, number>;
  limits?: Partial<WorkloopConfig['limits']>;
  paths?: Partial<WorkloopConfig['paths']>;
  tracker?: Partial<WorkloopConfig['tracker']>;
  local_only?: string[];
  skills?: Record<string, string>;
}

export const DEFAULT_CONFIG: WorkloopConfig = {
  repo: null,
  worker_command: 'forger:auto-ticket',
  gates: '',
  base_branch: 'main',
  /**
   * P0 is the foundation. A subtle error there is both expensive and invisible,
   * so those tickets get the stronger model and a wider budget. A cap that
   * stops a ticket finishing costs more than the headroom it saves: the agent
   * commits, then dies before pushing/merging, leaving the backlog claiming
   * work that only exists on a local branch.
   */
  model_by_priority: {
    P0: {model: 'opus', budget: 22.5},
    default: {model: 'sonnet', budget: 18.0},
  },
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
  },
  paths: {
    backlog: '.claude/backlog.json',
    state: '.claude/state.json',
    log: '.claude/work.log',
    output: '.claude/output',
    halt: '.claude/HALT',
    lock: '.claude/runner.lock',
    events: '.claude/events.jsonl',
  },
  tracker: {kind: 'github', label: 'ready-for-agent', ignore: []},
  local_only: [],
  skills: {},
};

/**
 * Merge a partial user config over a base, one level deep for each nested
 * section so a user who overrides only `limits.timeoutMinutes` keeps every
 * other default. Pure - no I/O - so the merge logic is unit-testable.
 */
export function mergeConfig(
  user: WorkloopConfigInput,
  base: WorkloopConfig = DEFAULT_CONFIG
): WorkloopConfig {
  return {
    ...base,
    ...user,
    model_by_priority: {
      ...base.model_by_priority,
      ...(user.model_by_priority ?? {}),
    } as WorkloopConfig['model_by_priority'],
    effort_multiplier: {
      ...base.effort_multiplier,
      ...(user.effort_multiplier ?? {}),
    },
    limits: {...base.limits, ...(user.limits ?? {})},
    paths: {...base.paths, ...(user.paths ?? {})},
    tracker: {...base.tracker, ...(user.tracker ?? {})},
    skills: {...base.skills, ...(user.skills ?? {})},
  };
}

/** Read `.claude/workloop.config.json` and merge it over the defaults. */
export function loadConfig(projectRoot: string): WorkloopConfig {
  const file = join(projectRoot, '.claude', 'workloop.config.json');
  if (!existsSync(file)) return mergeConfig({});
  let user: WorkloopConfigInput;
  try {
    user = JSON.parse(readFileSync(file, 'utf-8')) as WorkloopConfigInput;
  } catch (e) {
    throw new Error(`Invalid .claude/workloop.config.json: ${(e as Error).message}`);
  }
  return mergeConfig(user);
}
