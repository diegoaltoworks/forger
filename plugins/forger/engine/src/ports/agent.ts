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
}

export type AgentResult = SupervisedResult;

export interface AgentRunOptions {
  prompt: string;
  sessionId: string;
  /** The role and budget chosen for the ticket. */
  tier: Tier;
  /** The model id the tier's role maps to, for harnesses that take one. */
  model: string;
  cwd: string;
  timeoutMinutes: number;
  killGraceSeconds: number;
}

/** Runs one worker iteration to completion or to its deadline. */
export interface AgentRunner {
  run(opts: AgentRunOptions): Promise<AgentResult>;
}
