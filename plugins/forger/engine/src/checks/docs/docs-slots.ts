/**
 * A command file may name only the slots its stages have in the pipeline
 * definition (ADR 0016 section 1), so the prose and the definition cannot
 * drift. Pure: the caller hands in the slots per command.
 */

import type {Finding} from '../waivers';

export interface DefinitionShape {
  stages: Array<{command: string; slots: Array<{slot: string}>}>;
}

/** Command name -> the slot ids its stages run. */
export function slotsByCommand(def: DefinitionShape): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const stage of def.stages) {
    const have = (out[stage.command] ??= []);
    for (const s of stage.slots) if (!have.includes(s.slot)) have.push(s.slot);
  }
  return out;
}

const SLOT_MENTION = /`([a-z][a-z0-9_]*)`\s+slot\b/g;

export function checkCommandSlots(file: string, text: string, byCommand: Record<string, string[]>): Finding[] {
  const command = file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const allowed = byCommand[command] ?? [];
  const out: Finding[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(SLOT_MENTION)) {
      if (allowed.includes(m[1])) continue;
      const have = allowed.length > 0 ? allowed.join(', ') : 'none';
      out.push({
        file,
        line: i + 1,
        rule: 'command-slot',
        opinion: 'base.no-hard-coded-skills',
        detail: `the ${command} command names the slot "${m[1]}", which none of its stages has (its slots: ${have})`,
      });
    }
  });
  return out;
}
