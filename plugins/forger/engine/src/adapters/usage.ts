/**
 * Reading usage out of a harness's structured output. Pure: each reader takes the
 * output so far and returns what it states, so each is tested against a recorded sample.
 */

import type {ModelPrice} from '../config';

function events(output: string): Array<Record<string, any>> {
  const found: Array<Record<string, any>> = [];
  for (const line of output.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') found.push(value);
    } catch {
      // A partial line at the end of a chunk, or text that only looks like JSON.
    }
  }
  return found;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * OpenCode `run --format json`: every `step_finish` event carries the step's `cost`
 * in USD, which OpenCode computes from its own model table. Null before the first step ends.
 */
export function opencodeSpentUsd(output: string): number | null {
  const steps = events(output).filter(e => e.type === 'step_finish' || e.type === 'step-finish');
  if (steps.length === 0) return null;
  return steps.reduce((sum, e) => sum + num(e.part?.cost), 0);
}

/** The text parts of an OpenCode `run --format json` stream, in order. */
export function opencodeText(output: string): string {
  return events(output)
    .filter(e => e.type === 'text' && typeof e.part?.text === 'string')
    .map(e => e.part.text)
    .join('\n');
}

/**
 * Codex `exec --json`: each `turn.completed` event carries `usage` token counts and no cost, so the
 * spend is the counts at `price`. Null with no price or before the first turn ends. Cached input is
 * part of `input_tokens` and bills at its own rate; reasoning tokens are part of `output_tokens`.
 */
export function codexSpentUsd(output: string, price?: ModelPrice): number | null {
  if (!price) return null;
  const turns = events(output).filter(e => e.type === 'turn.completed' && e.usage);
  if (turns.length === 0) return null;
  let usd = 0;
  for (const {usage} of turns) {
    const cached = Math.min(num(usage.cached_input_tokens), num(usage.input_tokens));
    usd += (num(usage.input_tokens) - cached) * price.input + cached * (price.cached_input ?? price.input) + num(usage.output_tokens) * price.output;
  }
  return usd / 1_000_000;
}

/** The agent messages of a Codex `exec --json` stream, in order. */
export function codexText(output: string): string {
  return events(output)
    .filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string')
    .map(e => e.item.text)
    .join('\n');
}
