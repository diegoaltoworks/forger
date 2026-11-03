/**
 * Spawns the headless `claude` process for one iteration under the
 * per-iteration deadline. The process supervision lives in `supervise.ts`;
 * this module only knows how to invoke `claude`.
 */

import type {Tier} from './config';
import {type SupervisedResult, runSupervised} from './supervise';

export type ClaudeResult = SupervisedResult;

export interface RunClaudeOptions {
  prompt: string;
  sessionId: string;
  tier: Tier;
  cwd: string;
  timeoutMinutes: number;
  killGraceSeconds: number;
}

export function runClaude(opts: RunClaudeOptions): Promise<ClaudeResult> {
  const {prompt, sessionId, tier, cwd, timeoutMinutes, killGraceSeconds} = opts;
  return runSupervised({
    command: 'claude',
    args: [
      '--print',
      '--model',
      tier.model,
      '--max-budget-usd',
      tier.budget.toString(),
      '--session-id',
      sessionId,
      '--dangerously-skip-permissions',
    ],
    cwd,
    input: prompt,
    timeoutMs: timeoutMinutes * 60 * 1000,
    graceMs: killGraceSeconds * 1000,
  });
}
