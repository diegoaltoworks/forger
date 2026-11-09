/**
 * The structure ratchet. The baseline records the findings a repository
 * already has, so adopting the check does not turn it red on day one; a
 * recorded finding is a warning and anything beyond the record fails. The
 * record only shrinks: `--update` drops entries that no longer hold and adds
 * none. All pure over parsed text.
 */

import {type Observation, type StructureRule} from './structure';
import type {Finding} from '../waivers';

export const STRUCTURE_BASELINE_PATH = '.forger/structure-baseline.json';
export const STRUCTURE_BASELINE_OPINION = 'structure.baseline-ratchet';

export type Entry = Omit<Observation, 'message' | 'line'>;

export interface StructureBaseline {
  entries: Entry[];
}

export class StructureBaselineError extends Error {
  constructor(problem: string) {
    super(`${STRUCTURE_BASELINE_PATH}: ${problem}`);
  }
}

const RULES: StructureRule[] = ['structure.folder-size', 'structure.prefix-cluster', 'structure.name-repeats-folder', 'structure.frozen-folder', 'structure.shim', 'structure.server-guard', 'structure.client-imports-server', 'structure.boundary', 'structure.cycle'];

export function parseStructureBaseline(text: string): StructureBaseline {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StructureBaselineError('is not valid JSON');
  }
  const list = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).entries : undefined;
  if (!Array.isArray(list)) throw new StructureBaselineError('must be an object with an "entries" list');
  const entries = list.map((e, i): Entry => {
    const where = `entries[${i}]`;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new StructureBaselineError(`${where} must be an object`);
    const o = e as Record<string, unknown>;
    if (typeof o.rule !== 'string' || !RULES.includes(o.rule as StructureRule)) throw new StructureBaselineError(`${where} needs a known "rule"`);
    if (typeof o.path !== 'string' || o.path === '') throw new StructureBaselineError(`${where} needs a "path"`);
    const entry: Entry = {rule: o.rule as StructureRule, path: o.path};
    if (o.count !== undefined) {
      if (typeof o.count !== 'number') throw new StructureBaselineError(`${where}.count must be a number`);
      entry.count = o.count;
    }
    if (o.prefix !== undefined) {
      if (typeof o.prefix !== 'string') throw new StructureBaselineError(`${where}.prefix must be a string`);
      entry.prefix = o.prefix;
    }
    if (o.key !== undefined) {
      if (typeof o.key !== 'string') throw new StructureBaselineError(`${where}.key must be a string`);
      entry.key = o.key;
    }
    if (o.files !== undefined) {
      if (!Array.isArray(o.files) || o.files.some(f => typeof f !== 'string')) throw new StructureBaselineError(`${where}.files must be a list of strings`);
      entry.files = o.files as string[];
    }
    return entry;
  });
  return {entries};
}

const strip = ({message: _message, line: _line, ...entry}: Observation): Entry => entry;

const identity = (o: Entry | Observation): string => `${o.rule}|${o.path}|${o.prefix ?? ''}|${o.key ?? ''}`;

export function renderStructureBaseline(observations: Observation[]): string {
  const entries = observations.map(strip).sort((a, b) => identity(a).localeCompare(identity(b)));
  return `${JSON.stringify({entries}, null, 2)}\n`;
}

function recorded(o: Observation, baseline: StructureBaseline): Entry | undefined {
  return baseline.entries.find(e => identity(e) === identity(o));
}

/** Whether an observation stays inside what the baseline recorded for it. */
function within(o: Observation, e: Entry): boolean {
  if (o.rule === 'structure.folder-size') return (o.count ?? 0) <= (e.count ?? 0);
  if (o.rule === 'structure.prefix-cluster') return (o.files ?? []).every(f => (e.files ?? []).includes(f));
  return true;
}

/** Splits observations into new ones (fail) and recorded ones (warn). No baseline means everything is new. */
export function classify(observations: Observation[], baseline: StructureBaseline | null): {fresh: Observation[]; recorded: Observation[]} {
  const fresh: Observation[] = [];
  const known: Observation[] = [];
  for (const o of observations) {
    const e = baseline ? recorded(o, baseline) : undefined;
    (e && within(o, e) ? known : fresh).push(o);
  }
  return {fresh, recorded: known};
}

/** The baseline after `--update`: entries that still hold, shrunk to the current state, with nothing added. */
export function shrink(observations: Observation[], baseline: StructureBaseline): StructureBaseline {
  const entries: Entry[] = [];
  for (const e of baseline.entries) {
    const o = observations.find(x => identity(x) === identity(e));
    if (!o) continue;
    const next = {...e};
    if (e.count !== undefined) next.count = Math.min(e.count, o.count ?? e.count);
    if (e.files !== undefined) next.files = e.files.filter(f => (o.files ?? []).includes(f));
    entries.push(next);
  }
  return {entries};
}

/** Findings for every entry the branch's baseline gained over the merge-base's: a bigger record is a loosened guarantee. */
export function baselineGrew(before: StructureBaseline, after: StructureBaseline): Finding[] {
  const out: Finding[] = [];
  for (const e of after.entries) {
    const old = before.entries.find(b => identity(b) === identity(e));
    const grew = !old || (e.count ?? 0) > (old.count ?? 0) || (e.files ?? []).some(f => !(old.files ?? []).includes(f));
    if (grew) {
      out.push({
        file: STRUCTURE_BASELINE_PATH,
        line: 1,
        rule: STRUCTURE_BASELINE_OPINION,
        opinion: STRUCTURE_BASELINE_OPINION,
        detail: `${e.rule} for ${e.path} was added or grew; fix the structure instead, or ask the owner, who records the answer with "decide <n>", and the ticket's Decisions then name ${STRUCTURE_BASELINE_PATH}`,
      });
    }
  }
  return out;
}
