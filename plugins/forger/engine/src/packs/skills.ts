/**
 * Skill slots: the points where a model does judgement work. Each slot has a
 * built-in forger step; a project may map any installed skill onto it. Commands
 * never name a third-party skill, they ask `skills --json` which one to invoke.
 * Resolution is pure; the installed-skills lookup and preset loading are the I/O.
 */

import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

export interface SlotDefinition {
  slot: string;
  /** The command that invokes the slot. */
  usedBy: string;
  /** What forger does itself when no skill is plugged in. */
  builtin: string;
}

export const SLOTS: readonly SlotDefinition[] = [
  {slot: 'interview', usedBy: 'plan', builtin: 'Ask the open decisions in numbered rounds, each with a recommended answer'},
  {slot: 'glossary', usedBy: 'plan', builtin: 'Record new terms in GLOSSARY.md and decisions in docs/adr/'},
  {slot: 'design', usedBy: 'plan', builtin: 'Write a static grey-box HTML wireframe to docs/design/<ticket>/index.html, capture it with screenshot --wireframe, link both'},
  {slot: 'test_first', usedBy: 'auto-ticket', builtin: 'Write the failing test, make it pass, then refactor'},
  {slot: 'review', usedBy: 'auto-ticket', builtin: 'Review the diff against the base on standards and spec'},
  {slot: 'diagnose', usedBy: 'auto-ticket', builtin: 'Reproduce the red gate, form one hypothesis, test it'},
  {slot: 'merge_conflicts', usedBy: 'auto-ticket', builtin: 'Resolve the conflict by hand and re-run the gates'},
];

export interface ResolvedSlot extends SlotDefinition {
  /** The configured skill, or null when the slot is unmapped. */
  skill: string | null;
  installed: boolean;
  /** `skill` only when a skill is mapped and installed; otherwise the built-in step. */
  use: 'skill' | 'builtin';
}

export interface SkillsReport {
  slots: ResolvedSlot[];
  /** Configured keys that are not slots, so a typo is visible rather than silent. */
  unknown: string[];
}

export function resolveSkills(mapping: Record<string, string>, installed: readonly string[]): SkillsReport {
  const have = new Set(installed);
  const slots = SLOTS.map(def => {
    const skill = mapping[def.slot]?.trim() || null;
    const isInstalled = skill !== null && have.has(skill);
    return {...def, skill, installed: isInstalled, use: isInstalled ? ('skill' as const) : ('builtin' as const)};
  });
  const known = new Set(SLOTS.map(s => s.slot));
  return {slots, unknown: Object.keys(mapping).filter(k => !known.has(k))};
}

export function formatSkills(report: SkillsReport): string {
  const rows = report.slots.map(s => {
    const target = s.skill === null ? 'unmapped' : `${s.skill} (${s.installed ? 'installed' : 'not installed'})`;
    return `${s.slot.padEnd(16)} ${s.use.padEnd(8)} ${target}`;
  });
  if (report.unknown.length > 0) rows.push(`unknown slots in config: ${report.unknown.join(', ')}`);
  return rows.join('\n');
}

export interface Preset {
  name: string;
  collection: string;
  description: string;
  skills: Record<string, string>;
}

export interface OfferedPreset {
  name: string;
  collection: string;
  description: string;
  skills: Record<string, string>;
}

/** A preset is offered when at least one skill of its collection is installed. */
export function offerPresets(presets: readonly Preset[], installed: readonly string[]): OfferedPreset[] {
  return presets
    .filter(p => installed.some(s => s.startsWith(`${p.collection}:`)))
    .map(({name, collection, description, skills}) => ({name, collection, description, skills}));
}

export function loadPresets(pluginRoot: string): Preset[] {
  const dir = join(pluginRoot, 'presets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Omit<Preset, 'name'>;
      return {name: f.replace(/\.json$/, ''), ...data};
    });
}

function skillDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true})
    .filter(e => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(dir, e.name, 'SKILL.md')))
    .map(e => e.name);
}

/**
 * Plugin skills are `<plugin>:<skill>`; user and project skills are bare names.
 * The plugin list is Claude Code's own record of what is installed.
 */
export function listInstalledSkills(home: string, projectRoot: string): string[] {
  const out = new Set<string>();
  for (const name of skillDirs(join(home, '.claude', 'skills'))) out.add(name);
  for (const name of skillDirs(join(projectRoot, '.claude', 'skills'))) out.add(name);

  const record = join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (existsSync(record)) {
    let plugins: Record<string, Array<{installPath?: string}>> = {};
    try {
      plugins = (JSON.parse(readFileSync(record, 'utf-8')) as {plugins?: typeof plugins}).plugins ?? {};
    } catch {
      plugins = {};
    }
    for (const [key, installs] of Object.entries(plugins)) {
      const plugin = key.split('@')[0];
      for (const install of installs) {
        if (!install.installPath) continue;
        for (const name of skillDirs(join(install.installPath, 'skills'))) out.add(`${plugin}:${name}`);
      }
    }
  }
  return [...out].sort();
}
