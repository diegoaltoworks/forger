import type {SkillMapping} from '../config';
import {globToRegExp} from '../checks';
import {resolveSlot, SLOTS, type ResolveEnv} from '../packs';
import {mergeOverlay} from './overlay';
import {pickCandidate, flavourRef} from './flavour';
import type {Condition, Definition, Flavour, StageSlot, TicketFacts} from './types';

export interface PlannedSlot {
  slot: string;
  contract: string;
  invoke: 'skill' | 'file' | 'builtin';
  /** The skill name, the file path, or the built-in step (null when forger has no line for the slot). */
  target: string | null;
  on?: string;
  reason: string;
}

export interface PlannedStage {
  id: string;
  command: string;
  inputs: string[];
  gate: string;
  slots: PlannedSlot[];
  /** Slots whose `when` does not hold for this ticket, with why. */
  skipped: Array<{slot: string; reason: string}>;
}

export interface PipelinePlan {
  ticket: string | null;
  /** The flavour the plan was resolved with, as the config names it. */
  flavour: string;
  stages: PlannedStage[];
  disabled: string[];
  problems: string[];
}

function list(items: readonly string[]): string {
  return `[${items.join(', ')}]`;
}

/** The first condition key that fails for the ticket, as a sentence, or null when every key holds. */
export function failedCondition(when: Condition | undefined, ticket: TicketFacts): string | null {
  if (!when) return null;
  const has = (l: string): boolean => ticket.labels.includes(l);
  if (when.labels_any && !when.labels_any.some(has)) return `when labels_any ${list(when.labels_any)} does not hold`;
  if (when.labels_none && when.labels_none.some(has)) return `when labels_none ${list(when.labels_none)} does not hold`;
  if (when.paths_any) {
    const res = when.paths_any.map(globToRegExp);
    if (!ticket.paths.some(p => res.some(re => re.test(p)))) return `when paths_any ${list(when.paths_any)} does not hold`;
  }
  if (when.packs_all && !when.packs_all.every(p => ticket.packs.includes(p))) return `when packs_all ${list(when.packs_all)} does not hold`;
  return null;
}

function holds(when: Condition | undefined): string {
  if (!when) return '';
  const keys = Object.entries(when).map(([k, v]) => `${k} ${list(v as string[])}`);
  return keys.length > 0 ? `; when ${keys.join(' and ')} holds` : '';
}

function planSlot(s: StageSlot, flavour: Flavour, overrides: Record<string, SkillMapping>, have: ReadonlySet<string>, ticket: TicketFacts, env: ResolveEnv): PlannedSlot {
  const def = SLOTS.find(d => d.slot === s.slot) ?? {slot: s.slot, usedBy: '', builtin: ''};
  const on = s.on ? {on: s.on} : {};
  const base = {slot: s.slot, contract: s.contract, ...on};
  const extra = holds(s.when);
  const target = def.builtin === '' ? null : def.builtin;
  if (overrides[s.slot] !== undefined) {
    const r = resolveSlot(def, overrides, have, env);
    if (r.invoke === 'skill') return {...base, invoke: 'skill', target: r.skill, reason: `skills map${extra}`};
    if (r.invoke === 'file') return {...base, invoke: 'file', target: r.path, reason: `skills map${extra}`};
    const missing = r.file !== null ? `skills map names file ${r.file}, not found` : r.skill !== null ? `skills map names ${r.skill}, not installed` : null;
    return {...base, invoke: 'builtin', target, reason: `builtin${missing ? `: ${missing}` : ''}${extra}`};
  }
  const pick = pickCandidate(def, flavour, ticket, have, env);
  const r = pick.resolved;
  if (r?.invoke === 'skill') return {...base, invoke: 'skill', target: r.skill, reason: `${pick.reason}${extra}`};
  if (r?.invoke === 'file') return {...base, invoke: 'file', target: r.path, reason: `${pick.reason}${extra}`};
  return {...base, invoke: 'builtin', target, reason: `builtin: ${pick.reason}${extra}`};
}

/**
 * The plan for one ticket: the definition with the overlay applied, each slot
 * resolved by the project's `skills` map first, then the flavour's candidates
 * for the ticket, then the built-in step, each with the reason it was chosen. Pure.
 */
export function resolvePipeline(
  definition: Definition,
  overlay: unknown,
  flavour: Flavour,
  overrides: Record<string, SkillMapping>,
  installed: readonly string[],
  ticket: TicketFacts,
  env: ResolveEnv = {}
): PipelinePlan {
  const merged = mergeOverlay(definition, overlay);
  const have = new Set(installed);
  const stages = merged.definition.stages.map((stage): PlannedStage => {
    const slots: PlannedSlot[] = [];
    const skipped: PlannedStage['skipped'] = [];
    for (const s of stage.slots) {
      const failed = failedCondition(s.when, ticket);
      if (failed !== null) skipped.push({slot: s.slot, reason: failed});
      else slots.push(planSlot(s, flavour, overrides, have, ticket, env));
    }
    return {id: stage.id, command: stage.command, inputs: stage.inputs, gate: stage.gate, slots, skipped};
  });
  return {ticket: ticket.id, flavour: flavourRef(flavour), stages, disabled: merged.disabled, problems: merged.problems};
}
