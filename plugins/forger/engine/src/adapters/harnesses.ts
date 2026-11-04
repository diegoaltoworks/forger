/**
 * The harnesses forger ships, by id, and the `AgentRunner` any of them yields.
 * The process supervision lives in `supervise.ts`; a harness only says what to run.
 */

import type {AgentRunner, Harness} from '../ports';
import {claudeHarness} from './claude';
import {codexHarness} from './codex';
import {copilotHarness} from './copilot';
import {opencodeHarness} from './opencode';
import {runSupervised} from './supervise';

export const HARNESSES: Harness[] = [claudeHarness, opencodeHarness, codexHarness, copilotHarness];

export function findHarness(id: string, harnesses: Harness[] = HARNESSES): Harness {
  const found = harnesses.find(h => h.id === id);
  if (!found) throw new Error(`Unknown harness "${id}"; available: ${harnesses.map(h => h.id).join(', ')}`);
  return found;
}

export function agentFor(harness: Harness): AgentRunner {
  return {
    run(opts) {
      const spec = harness.spawn(opts);
      return runSupervised({
        command: spec.command,
        args: spec.args,
        cwd: opts.cwd,
        env: opts.env,
        input: spec.input ?? '',
        timeoutMs: opts.timeoutMinutes * 60 * 1000,
        graceMs: opts.killGraceSeconds * 1000,
        abort: opts.abort,
      });
    },
  };
}
