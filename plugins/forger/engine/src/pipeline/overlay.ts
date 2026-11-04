import type {Definition, Overlay, Stage, StageSlot} from './types';

export interface Merged {
  definition: Definition;
  /** Stages the overlay disabled, so a plan can say they are off rather than missing. */
  disabled: string[];
  /** Overlay content that names nothing or is malformed; reported, never silently dropped. */
  problems: string[];
}

const OVERLAY_KEYS = ['disable', 'add', 'gates'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** The default definition with the project's overlay applied. Pure; never reorders stages. */
export function mergeOverlay(definition: Definition, overlay: unknown): Merged {
  const problems: string[] = [];
  if (overlay === undefined || overlay === null) return {definition, disabled: [], problems};
  if (!isObject(overlay)) return {definition, disabled: [], problems: ['overlay: must be an object']};
  for (const key of Object.keys(overlay)) if (!OVERLAY_KEYS.includes(key)) problems.push(`overlay: unknown key "${key}"`);

  const known = new Set(definition.stages.map(s => s.id));
  const disabled = new Set<string>();
  const added = new Map<string, StageSlot[]>();
  const gates = new Map<string, string>();

  const disable = overlay.disable;
  if (disable !== undefined) {
    if (!Array.isArray(disable)) problems.push('overlay.disable: must be a list of stage ids');
    else
      for (const id of disable) {
        if (typeof id === 'string' && known.has(id)) disabled.add(id);
        else problems.push(`overlay.disable: unknown stage "${String(id)}"`);
      }
  }

  const add = overlay.add;
  if (add !== undefined) {
    if (!Array.isArray(add)) problems.push('overlay.add: must be a list of {stage, slot}');
    else
      add.forEach((entry, i) => {
        const where = `overlay.add[${i}]`;
        if (!isObject(entry) || !text(entry.stage) || !isObject(entry.slot)) return void problems.push(`${where}: needs a stage and a slot object`);
        if (!known.has(entry.stage)) return void problems.push(`${where}: unknown stage "${entry.stage}"`);
        const slot = entry.slot;
        if (!text(slot.slot) || !text(slot.contract)) return void problems.push(`${where}: the slot needs a slot name and a contract`);
        added.set(entry.stage, [...(added.get(entry.stage) ?? []), slot as unknown as StageSlot]);
      });
  }

  const replaced = overlay.gates;
  if (replaced !== undefined) {
    if (!isObject(replaced)) problems.push('overlay.gates: must map a stage id to a gate command');
    else
      for (const [id, gate] of Object.entries(replaced)) {
        if (!known.has(id)) problems.push(`overlay.gates: unknown stage "${id}"`);
        else if (!text(gate)) problems.push(`overlay.gates.${id}: must be a command`);
        else gates.set(id, gate);
      }
  }

  const stages = definition.stages
    .filter(s => !disabled.has(s.id))
    .map((s): Stage => ({...s, slots: [...s.slots, ...(added.get(s.id) ?? [])], gate: gates.get(s.id) ?? s.gate}));
  return {definition: {...definition, stages}, disabled: [...disabled], problems};
}

export type {Overlay};
