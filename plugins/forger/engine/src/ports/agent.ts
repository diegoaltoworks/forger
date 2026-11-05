/**
 * The agent spawn as the loop sees it. The loop is written against
 * `AgentRunner`; each harness that can run a worker is an adapter that
 * implements it (see adapters/), and the CLI hands one in.
 */

import type {Tier} from '../config';

export interface SupervisedResult {
  exitCode: number;
  /** The signal that ended the worker, or null if it exited on its own. */
  signal: string | null;
  output: string;
  timedOut: boolean;
  /** Set when the engine stopped the worker for passing its spend limit. */
  overSpend?: {limitUsd: number; spentUsd: number} | null;
  /** Why the prompt did not reach the worker's stdin; null or absent when it did. */
  inputError?: string | null;
}

export type AgentResult = SupervisedResult;

export interface AgentRunOptions {
  prompt: string;
  sessionId: string;
  /** The role and budget chosen for the ticket. */
  tier: Tier;
  /** The model id the tier's role maps to, for harnesses that take one. */
  model: string;
  /** The worker command to run, without the leading slash (`forger:auto-ticket`). */
  workerCommand: string;
  cwd: string;
  /** Added to the worker's environment: the engine names the worker's role and ticket there, for its hook. */
  env?: Record<string, string>;
  timeoutMinutes: number;
  killGraceSeconds: number;
  /** Ends the worker's process group (SIGTERM, then SIGKILL after the grace) when aborted, as the loop does on HALT. */
  abort?: AbortSignal;
}

/**
 * Whether the engine can stop a worker for passing its budget: `harness` when the harness caps it
 * itself, `engine` when the engine reads the reported spend, `none` when neither can, `partial` when
 * only some of the models asked about are covered.
 */
export type SpendLimit = 'harness' | 'engine' | 'none' | 'partial';

/** Runs one worker iteration to completion or to its deadline. */
export interface AgentRunner {
  run(opts: AgentRunOptions): Promise<AgentResult>;
  /** The spend limit that holds for a run on each of `models`; absent when the runner cannot say. */
  spendLimit?(models: string[]): SpendLimit;
  /** The harness's id, for the log line that says it has no spend limit. */
  harnessId?: string;
}
