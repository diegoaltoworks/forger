/**
 * The agent spawn as the loop sees it: what one worker run is given and what it
 * returns. The loop is written against these types; the real spawn lives in
 * adapters and is handed in by the CLI.
 */

import type {Tier} from '../config';

export interface SupervisedResult {
  exitCode: number;
  /** The signal that ended the worker, or null if it exited on its own. */
  signal: string | null;
  output: string;
  timedOut: boolean;
}

export type ClaudeResult = SupervisedResult;

export interface RunClaudeOptions {
  prompt: string;
  sessionId: string;
  tier: Tier;
  cwd: string;
  timeoutMinutes: number;
  killGraceSeconds: number;
}
