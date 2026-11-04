import type {SkillMapping} from '../config';
import {globToRegExp} from '../checks';
import {resolveSlot, SLOTS, type ResolvedSlot, type ResolveEnv, type SlotDefinition} from '../packs';
import type {Candidate, Condition, Flavour, TicketFacts} from './types';

export const DEFAULT_FLAVOUR = 'default';

const CONDITION_KEYS = ['labels_any', 'labels_none', 'paths_any', 'packs_all'] as const;

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim() !== '');
}

function parseCandidate(c: unknown, where: string): Candidate {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${where}: a candidate must be an object`);
  const o = c as Record<string, unknown>;
  const hasSkill = typeof o.skill === 'string' && o.skill.trim() !== '';
  const hasFile = typeof o.file === 'string' && o.file.trim() !== '';
  if (hasSkill === hasFile) throw new Error(`${where}: a candidate names exactly one of skill or file`);
  const out: Candidate = hasSkill ? {skill: (o.skill as string).trim()} : {file: (o.file as string).trim()};
  if (o.when !== undefined) {
    if (o.when === null || typeof o.when !== 'object' || Array.isArray(o.when)) throw new Error(`${where}: when must be an object`);
    const when: Condition = {};
    for (const [k, v] of Object.entries(o.when as Record<string, unknown>)) {
      if (!(CONDITION_KEYS as readonly string[]).includes(k)) throw new Error(`${where}: unknown condition "${k}"`);
      if (!isStringList(v)) throw new Error(`${where}: ${k} must be a list of strings`);
      when[k as keyof Condition] = v;
    }
    out.when = when;
  }
  return out;
}

/** A flavour file read as data: throws an error naming the file and the field when it is malformed. Pure. */
export function parseFlavour(data: unknown, source: string): Flavour {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${source}: a flavour must be an object`);
  const o = data as Record<string, unknown>;
  if (typeof o.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(o.name)) throw new Error(`${source}: name must be a plain name`);
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) throw new Error(`${source}: version must be a whole number of at least 1`);
  if (typeof o.description !== 'string') throw new Error(`${source}: description must be a string`);
  if (o.slots === null || typeof o.slots !== 'object' || Array.isArray(o.slots)) throw new Error(`${source}: slots must be an object`);
  const slots: Record<string, Candidate[]> = {};
  for (const [slot, list] of Object.entries(o.slots as Record<string, unknown>)) {
    if (!Array.isArray(list)) throw new Error(`${source}: slots.${slot} must be a list of candidates`);
    slots[slot] = list.map((c, i) => parseCandidate(c, `${source}: slots.${slot}[${i}]`));
  }
  const flavour: Flavour = {name: o.name, version: o.version, description: o.description, slots};
  for (const k of ['aliases', 'forbid'] as const) {
    if (o[k] === undefined) continue;
    if (!isStringList(o[k])) throw new Error(`${source}: ${k} must be a list of strings`);
    flavour[k] = o[k] as string[];
  }
  for (const k of ['collection', 'plugin'] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'string') throw new Error(`${source}: ${k} must be a string`);
    flavour[k] = o[k] as string;
  }
  return flavour;
}

export interface FlavourRef {
  name: string;
  /** The pinned version, or null when the config names the flavour without one. */
  version: number | null;
}

/** `"name"` or `"name@version"`. Throws on anything else. Pure. */
export function parseFlavourRef(ref: string): FlavourRef {
  const m = /^([A-Za-z0-9._-]+)(?:@(\d+))?$/.exec(ref.trim());
  if (!m) throw new Error(`flavour must be "<name>" or "<name>@<version>", got "${ref}"`);
  return {name: m[1], version: m[2] === undefined ? null : Number(m[2])};
}

/** A flavour as the config names it. */
export function flavourRef(f: Pick<Flavour, 'name' | 'version'>): string {
  return `${f.name}@${f.version}`;
}

/** The flavour a ref pins, or a sentence on why the one found does not match. Pure. */
export function checkPin(ref: FlavourRef, found: Flavour): string | null {
  if (ref.version === null || ref.version === found.version) return null;
  return `config pins ${ref.name}@${ref.version} but the flavour found is version ${found.version}`;
}

/** The newer shipped version of a pinned flavour, or null. Pure. */
export function newerFlavour(ref: FlavourRef, shipped: Pick<Flavour, 'name' | 'version'> | undefined): number | null {
  if (!shipped || ref.version === null || shipped.name !== ref.name) return null;
  return shipped.version > ref.version ? shipped.version : null;
}

function list(items: readonly string[]): string {
  return `[${items.join(', ')}]`;
}

/** Why a candidate's conditions fail for the ticket, or null when every key holds. Pure. */
export function candidateFailure(when: Condition | undefined, ticket: TicketFacts): string | null {
  if (!when) return null;
  const has = (l: string): boolean => ticket.labels.includes(l);
  if (when.labels_any && !when.labels_any.some(has)) return `labels_any ${list(when.labels_any)} failed`;
  if (when.labels_none && when.labels_none.some(has)) return `labels_none ${list(when.labels_none)} failed`;
  if (when.paths_any) {
    const res = when.paths_any.map(globToRegExp);
    if (!ticket.paths.some(p => res.some(re => re.test(p)))) return `paths_any did not match ${ticket.paths.length > 0 ? ticket.paths.join(', ') : 'any path'}`;
  }
  if (when.packs_all && !when.packs_all.every(p => ticket.packs.includes(p))) return `packs_all ${list(when.packs_all)} failed`;
  return null;
}

function holdsText(when: Condition | undefined): string {
  const keys = Object.entries(when ?? {}).map(([k, v]) => `${k} ${list(v as string[])} holds`);
  return keys.length > 0 ? `: ${keys.join(' and ')}` : '';
}

function asMapping(c: Candidate): SkillMapping {
  return c.file !== undefined ? {file: c.file} : (c.skill as string);
}

export interface Picked {
  /** The winning candidate resolved, or null when the built-in step runs. */
  resolved: ResolvedSlot | null;
  /** Which candidate won, or why each earlier one did not and the built-in runs. */
  reason: string;
}

/**
 * The first candidate of the slot whose conditions hold for the ticket and whose skill or file is
 * installed; otherwise the built-in with the reason each candidate lost. Pure.
 */
export function pickCandidate(def: SlotDefinition, flavour: Flavour, ticket: TicketFacts, have: ReadonlySet<string>, env: ResolveEnv = {}): Picked {
  const candidates = flavour.slots[def.slot] ?? [];
  if (candidates.length === 0) return {resolved: null, reason: flavour.name === DEFAULT_FLAVOUR ? `flavour ${DEFAULT_FLAVOUR}` : 'flavour maps nothing'};
  const lost: string[] = [];
  for (const [i, c] of candidates.entries()) {
    const n = i + 1;
    const label = lost.length === 0 ? `${flavour.name} candidate ${n}` : `candidate ${n}`;
    const failed = candidateFailure(c.when, ticket);
    if (failed !== null) {
      lost.push(`${label} ${failed}`);
      continue;
    }
    const resolved = resolveSlot(def, {[def.slot]: asMapping(c)}, have, env);
    if (resolved.invoke === 'builtin') {
      lost.push(`${label} ${c.file ?? c.skill} not installed`);
      continue;
    }
    return {resolved, reason: `${flavour.name} candidate ${n}${holdsText(c.when)}`};
  }
  return {resolved: null, reason: lost.join('; ')};
}

/**
 * The flavour as a plain slot -> skill mapping for a ticket with no labels and no paths: what
 * `skills --json` resolves when a worker asks before it knows the ticket. Pure.
 */
export function flavourMapping(flavour: Flavour, ticket: TicketFacts, installed: readonly string[], env: ResolveEnv = {}): Record<string, SkillMapping> {
  const have = new Set(installed);
  const out: Record<string, SkillMapping> = {};
  for (const slot of new Set([...SLOTS.map(s => s.slot), ...Object.keys(flavour.slots)])) {
    const def = SLOTS.find(d => d.slot === slot) ?? {slot, usedBy: '', builtin: ''};
    const {resolved} = pickCandidate(def, flavour, ticket, have, env);
    if (resolved?.invoke === 'skill' && resolved.skill) out[slot] = resolved.skill;
    else if (resolved?.invoke === 'file' && resolved.file) out[slot] = {file: resolved.file};
  }
  return out;
}
