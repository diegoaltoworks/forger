/**
 * The harnesses forger ships, by id, and the `AgentRunner` any of them yields.
 * The process supervision lives in `supervise.ts`; a harness only says what to run.
 */

import type {ModelPrice} from '../config';
import type {AgentRunner, Harness, Sandbox, SpendLimit} from '../ports';
import {claudeHarness} from './claude';
import {codexHarness} from './codex';
import {copilotHarness} from './copilot';
import {opencodeHarness} from './opencode';
import {hostSandbox} from './host-sandbox';

export const HARNESSES: Harness[] = [claudeHarness, opencodeHarness, codexHarness, copilotHarness];

export function findHarness(id: string, harnesses: Harness[] = HARNESSES): Harness {
  const found = harnesses.find(h => h.id === id);
  if (!found) throw new Error(`Unknown harness "${id}"; available: ${harnesses.map(h => h.id).join(', ')}`);
  return found;
}

/**
 * Whether the engine can stop a run of `harness` on `model` for passing its budget. Pure.
 * A `tokens` harness needs a price for the model; without one it reports nothing usable.
 */
export function spendLimitOf(harness: Harness, model: string, prices: Record<string, ModelPrice> = {}): Exclude<SpendLimit, 'partial'> {
  if (harness.usage === 'cap') return 'harness';
  if (!harness.spentUsd) return 'none';
  if (harness.usage === 'tokens' && !Object.prototype.hasOwnProperty.call(prices, model)) return 'none';
  return 'engine';
}

/** The agent a harness yields; its workers start only through `sandbox`. */
export function agentFor(harness: Harness, prices: Record<string, ModelPrice>, sandbox: Sandbox): AgentRunner {
  return {
    harnessId: harness.id,
    spendLimit(models) {
      const kinds = new Set(models.map(m => spendLimitOf(harness, m, prices)));
      return kinds.size === 1 ? [...kinds][0] : 'partial';
    },
    async run(opts) {
      const spec = harness.spawn(opts);
      const engineLimit = spendLimitOf(harness, opts.model, prices) === 'engine';
      const price = Object.prototype.hasOwnProperty.call(prices, opts.model) ? prices[opts.model] : undefined;
      const result = await sandbox.start({
        command: spec.command,
        args: spec.args,
        cwd: opts.cwd,
        env: opts.env,
        input: spec.input ?? '',
        timeoutMs: opts.timeoutMinutes * 60 * 1000,
        graceMs: opts.killGraceSeconds * 1000,
        abort: opts.abort,
        spendLimitUsd: engineLimit ? opts.tier.budget : undefined,
        spentUsd: engineLimit ? (output: string) => harness.spentUsd!(output, price) : undefined,
      }).result;
      // The claim and the stop reason are read from the worker's words, which a JSON stream escapes.
      const text = harness.plainText?.(result.output);
      return text ? {...result, output: `${result.output}\n${text}\n`} : result;
    },
  };
}

/**
 * Why `run` must not start with this harness, or null when it may. A harness
 * with no hook forger can install cannot refuse a call, so its worker is only
 * asked to keep the rules; the config says `allow_unguarded` to accept that.
 */
export function guardRefusal(harness: Harness, allowUnguarded: boolean): string | null {
  if (harness.hooks !== null || allowUnguarded) return null;
  return `the ${harness.id} harness cannot refuse a tool call, so the worker's rules are only requested, not enforced; set allow_unguarded: true in the config to run it anyway`;
}
