/**
 * Skill slots: the points where a model does judgement work. Each slot has a
 * built-in forger step; a project may map any installed skill onto it. Commands
 * never name a third-party skill, they ask `skills --json` which one to invoke.
 * Resolution is pure; the installed-skills lookup and preset loading are the I/O.
 */

import {existsSync, readdirSync, readFileSync} from 'fs';
import {isAbsolute, join} from 'path';

import type {SkillMapping} from '../config';

export interface SlotDefinition {
  slot: string;
  /** The command that invokes the slot. */
  usedBy: string;
  /** What forger does itself when no skill is plugged in. */
  builtin: string;
  /** The named output the slot's step must leave, for the pipeline definition to refer to. */
  output?: string;
}

export const SLOTS: readonly SlotDefinition[] = [
  {slot: 'interview', usedBy: 'plan', builtin: 'Ask the open decisions in numbered rounds, each with a recommended answer'},
  {slot: 'glossary', usedBy: 'plan', builtin: 'Record new terms in GLOSSARY.md and decisions in docs/adr/'},
  {slot: 'design', usedBy: 'plan', builtin: 'Write a static grey-box HTML wireframe to docs/design/<ticket>/index.html, capture it with screenshot --wireframe, link both'},
  {slot: 'test_first', usedBy: 'auto-ticket', builtin: 'Write the failing test, make it pass, then refactor'},
  {slot: 'review', usedBy: 'auto-ticket', builtin: 'Review the diff against the base on standards and spec'},
  {slot: 'diagnose', usedBy: 'auto-ticket', builtin: 'Reproduce the red gate, form one hypothesis, test it'},
  {slot: 'merge_conflicts', usedBy: 'auto-ticket', builtin: 'Resolve the conflict by hand and re-run the gates'},
  {slot: 'risk', usedBy: 'auto-ticket', output: 'risk_report', builtin: 'List what the change touches beyond the diff and run the tests for it'},
  {slot: 'pr_body', usedBy: 'auto-ticket', output: 'pr_body', builtin: 'Write the PR body by docs/03-tickets.md'},
  {slot: 'retro', usedBy: 'retro', output: 'retro_proposals', builtin: 'Walk the retro steps: capture, cause, form, write, land'},
];

/**
 * The rules every slot invocation travels with. The engine owns this string, not
 * a preset: a skill written for a human must run unattended inside forger's loop.
 * Later suffixes (an output contract) follow it.
 */
export const UNATTENDED_PREAMBLE = [
  'You are running unattended as one step of forger\'s loop.',
  'The intent is the ticket and its spec: never ask the owner a question; record an open question as a decline.',
  'Do not commit, push, merge or open pull requests: forger does.',
  'Do not route to another skill and do not start a loop of your own.',
].join(' ');

export type Invoke = 'skill' | 'file' | 'builtin';

export interface ResolvedSlot extends SlotDefinition {
  /** The skill to invoke by name (resolved against an unprefixed install), or null. */
  skill: string | null;
  /** The configured `{file}` as written, or null. */
  file: string | null;
  /** The mapped skill or file is present. */
  installed: boolean;
  /** How the slot is run: a skill by name, a file read and followed, or forger's built-in step. */
  invoke: Invoke;
  /** The resolved absolute path of a file slot, whether or not it exists. */
  path: string | null;
}

export interface SkillsReport {
  slots: ResolvedSlot[];
  /** Skills the worker must not invoke: the routers and loops of the installed collections. */
  forbid: string[];
  /** Wraps every slot invocation. */
  preamble: string;
  /** Configured keys that are not slots, so a typo is visible rather than silent. */
  unknown: string[];
}

export interface ResolveEnv {
  /** Absolute roots a relative `{file}` is looked up under, in order. */
  roots?: readonly string[];
  presets?: readonly Preset[];
  exists?: (path: string) => boolean;
}

/** A preset's collection is installed when a prefixed skill, or one of its bare aliases, is. */
export function collectionInstalled(preset: Preset, installed: readonly string[]): boolean {
  const prefixes = [preset.collection, preset.plugin].filter((p): p is string => !!p).map(p => `${p}:`);
  return installed.some(s => prefixes.some(p => s.startsWith(p)) || (preset.aliases ?? []).includes(s));
}

function resolveName(skill: string, have: ReadonlySet<string>, presets: readonly Preset[]): string | null {
  if (have.has(skill)) return skill;
  const i = skill.indexOf(':');
  if (i < 0) return null;
  const prefix = skill.slice(0, i);
  const bare = skill.slice(i + 1);
  const known = presets.some(p => (p.collection === prefix || p.plugin === prefix) && (p.aliases ?? []).includes(bare));
  return known && have.has(bare) ? bare : null;
}

function resolveFile(file: string, env: ResolveEnv): {path: string | null; exists: boolean} {
  const exists = env.exists ?? existsSync;
  const candidates = isAbsolute(file) ? [file] : (env.roots ?? []).map(r => join(r, file));
  const found = candidates.find(exists);
  return {path: found ?? candidates[0] ?? null, exists: found !== undefined};
}

/** One slot against the project's mapping: the mapped skill or file when present, else the built-in step. */
export function resolveSlot(def: SlotDefinition, mapping: Record<string, SkillMapping>, have: ReadonlySet<string>, env: ResolveEnv = {}): ResolvedSlot {
  const m = mapping[def.slot];
  if (m !== null && typeof m === 'object' && typeof m.file === 'string' && m.file.trim() !== '') {
    const file = m.file.trim();
    const {path, exists} = resolveFile(file, env);
    return {...def, skill: null, file, installed: exists, invoke: exists ? 'file' : 'builtin', path};
  }
  const name = typeof m === 'string' ? m.trim() : '';
  if (name === '') return {...def, skill: null, file: null, installed: false, invoke: 'builtin', path: null};
  const resolved = resolveName(name, have, env.presets ?? []);
  return {...def, skill: resolved ?? name, file: null, installed: resolved !== null, invoke: resolved !== null ? 'skill' : 'builtin', path: null};
}

export function resolveSkills(mapping: Record<string, SkillMapping>, installed: readonly string[], env: ResolveEnv = {}): SkillsReport {
  const have = new Set(installed);
  const presets = env.presets ?? [];
  const slots = SLOTS.map(def => resolveSlot(def, mapping, have, env));
  const known = new Set(SLOTS.map(s => s.slot));
  const forbid = [...new Set(presets.filter(p => collectionInstalled(p, installed)).flatMap(p => p.forbid ?? []))].sort();
  return {slots, forbid, preamble: UNATTENDED_PREAMBLE, unknown: Object.keys(mapping).filter(k => !known.has(k))};
}

export function formatSkills(report: SkillsReport): string {
  const rows = report.slots.map(s => {
    const target =
      s.file !== null ? `file ${s.file} (${s.installed ? 'found' : 'missing'})` : s.skill === null ? 'unmapped' : `${s.skill} (${s.installed ? 'installed' : 'not installed'})`;
    return `${s.slot.padEnd(16)} ${s.invoke.padEnd(8)} ${target}`;
  });
  if (report.forbid.length > 0) rows.push(`forbidden: ${report.forbid.join(', ')}`);
  if (report.unknown.length > 0) rows.push(`unknown slots in config: ${report.unknown.join(', ')}`);
  return rows.join('\n');
}

export interface Preset {
  name: string;
  collection: string;
  /** The plugin name of a plugin install, when it differs from the collection. */
  plugin?: string;
  /** Bare skill names of an install that carries no prefix. */
  aliases?: string[];
  /** Skills the worker must not invoke: routers, loops, and anything that owns the process. */
  forbid?: string[];
  description: string;
  skills: Record<string, SkillMapping>;
}

export type OfferedPreset = Preset;

/** A preset is offered when its collection is installed, with or without the plugin prefix. */
export function offerPresets(presets: readonly Preset[], installed: readonly string[]): OfferedPreset[] {
  return presets.filter(p => collectionInstalled(p, installed));
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

/** Install directories of the plugins Claude Code has recorded; a file slot's relative path is looked up under each. */
export function listCollectionRoots(home: string): string[] {
  const record = join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(record)) return [];
  try {
    const plugins = (JSON.parse(readFileSync(record, 'utf-8')) as {plugins?: Record<string, Array<{installPath?: string}>>}).plugins ?? {};
    return Object.values(plugins).flatMap(installs => installs.map(i => i.installPath).filter((p): p is string => !!p));
  } catch {
    return [];
  }
}
