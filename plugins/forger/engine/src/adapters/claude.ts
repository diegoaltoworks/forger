/**
 * The shipped agent adapter: the headless Claude Code CLI. The process
 * supervision lives in `supervise.ts`; this module only knows how to invoke
 * `claude`.
 */

import type {AgentResult, AgentRunner, AgentRunOptions} from '../ports';
import {runSupervised} from './supervise';

export const claudeAgent: AgentRunner = {
  run(opts: AgentRunOptions): Promise<AgentResult> {
    const {prompt, sessionId, tier, model, cwd, timeoutMinutes, killGraceSeconds} = opts;
    return runSupervised({
      command: 'claude',
      args: [
        '--print',
        '--model',
        model,
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
  },
};
