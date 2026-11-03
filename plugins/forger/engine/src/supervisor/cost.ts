/**
 * What a worker session cost, from the usage a harness leaves in its
 * transcript and a price table kept as data (ADR 0013). Pure: the CLI finds
 * and reads the transcript. No transcript, or a model with no price, is
 * unknown (null), never zero and never the cap.
 */

export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export type PriceTable = Record<string, ModelPrice>;

/**
 * Defaults by model family; a key matches a model id it is a part of, the
 * longest key first. A project overrides or extends them in `.forger/prices.json`.
 */
export const DEFAULT_PRICES: PriceTable = {
  opus: {input: 15, output: 75, cache_read: 1.5, cache_write: 18.75},
  sonnet: {input: 3, output: 15, cache_read: 0.3, cache_write: 3.75},
  haiku: {input: 1, output: 5, cache_read: 0.1, cache_write: 1.25},
};

const PRICE_FIELDS: (keyof ModelPrice)[] = ['input', 'output', 'cache_read', 'cache_write'];

/** The base table with a project's overrides applied; null when the override is not a price table. */
export function mergePrices(base: PriceTable, override: unknown): PriceTable | null {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) return null;
  const out: PriceTable = {...base};
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') return null;
    const p = value as Partial<Record<keyof ModelPrice, unknown>>;
    for (const f of PRICE_FIELDS) {
      const v = p[f];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    }
    out[key] = value as ModelPrice;
  }
  return out;
}

export function priceFor(model: string, prices: PriceTable): ModelPrice | null {
  if (prices[model] !== undefined) return prices[model];
  const key = Object.keys(prices)
    .filter(k => model.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return key === undefined ? null : prices[key];
}

/**
 * The usage of each assistant message in a JSONL transcript. A message the
 * harness wrote more than once counts once, by its last line.
 */
export function parseTranscriptUsage(text: string): UsageRecord[] {
  const byId = new Map<string, UsageRecord>();
  let anonymous = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let entry: {message?: {id?: unknown; model?: unknown; usage?: Record<string, unknown>} | null};
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const m = entry?.message;
    if (m === undefined || m === null || typeof m.model !== 'string' || m.usage === undefined || m.usage === null) continue;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const id = typeof m.id === 'string' ? m.id : `anonymous-${anonymous++}`;
    byId.set(id, {
      model: m.model,
      inputTokens: n(m.usage.input_tokens),
      outputTokens: n(m.usage.output_tokens),
      cacheReadTokens: n(m.usage.cache_read_input_tokens),
      cacheWriteTokens: n(m.usage.cache_creation_input_tokens),
    });
  }
  return [...byId.values()];
}

/** Dollars for the records; null when any record's model has no price. */
export function costUsd(records: UsageRecord[], prices: PriceTable): number | null {
  let total = 0;
  for (const r of records) {
    const p = priceFor(r.model, prices);
    if (p === null) return null;
    total += (r.inputTokens * p.input + r.outputTokens * p.output + r.cacheReadTokens * p.cache_read + r.cacheWriteTokens * p.cache_write) / 1_000_000;
  }
  return total;
}

/** A session's cost from its transcript text; null when there is no transcript. */
export function sessionCostUsd(transcript: string | null, prices: PriceTable): number | null {
  return transcript === null ? null : costUsd(parseTranscriptUsage(transcript), prices);
}
