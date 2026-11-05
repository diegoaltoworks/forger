/**
 * Skill slots: the points where a model does judgement work. Each slot has a
 * built-in forger step; a project may map any installed skill onto it. Commands
 * never name a third-party skill, they ask `skills --json` which one to invoke.
 * Resolution is pure; the installed-skills lookup and preset loading are the I/O.
 */

import {existsSync, readdirSync, readFileSync} from 'fs';
import {basename, dirname, isAbsolute, join} from 'path';

import type {SkillMapping} from '../config';

export interface SlotDefinition {
  slot: string;
  /** The command that invokes the slot. */
  usedBy: string;
  /** What forger does itself when no skill is plugged in. */
  builtin: string;
  /** The named output the slot's step must leave, for the pipeline definition to refer to. */
  output?: string;
  /** A skill file shipped in the plugin, relative to its root; the built-in runs it while the file exists. */
  builtinFile?: string;
}

export const SLOTS: readonly SlotDefinition[] = [
  {slot: 'interview', usedBy: 'plan', builtin: 'Ask the open decisions in numbered rounds, each with a recommended answer'},
  {slot: 'glossary', usedBy: 'plan', builtin: 'Record new terms in GLOSSARY.md and decisions in docs/adr/'},
  {slot: 'design', usedBy: 'plan', builtin: 'Write a static grey-box HTML wireframe to docs/design/<ticket>/index.html, capture it with screenshot --wireframe, link both'},
  {slot: 'prototype', usedBy: 'plan', output: 'concepts', builtinFile: 'skills/prototype/SKILL.md', builtin: 'Build two or three throwaway single-file HTML concepts that differ on the axis the brief leaves open'},
  {slot: 'test_first', usedBy: 'auto-ticket', builtinFile: 'skills/test_first/SKILL.md', builtin: 'Write the failing test, make it pass, then refactor'},
  {slot: 'review', usedBy: 'auto-ticket', builtinFile: 'skills/review/SKILL.md', builtin: 'Review the diff against the base on standards and spec'},
  {slot: 'diagnose', usedBy: 'auto-ticket', builtinFile: 'skills/diagnose/SKILL.md', builtin: 'Reproduce the red gate, form one hypothesis, test it'},
  {slot: 'merge_conflicts', usedBy: 'auto-ticket', builtin: 'Resolve the conflict by hand and re-run the gates'},
  {slot: 'risk', usedBy: 'auto-ticket', output: 'risk_report', builtin: 'List what the change touches beyond the diff and run the tests for it'},
  {slot: 'pr_body', usedBy: 'auto-ticket', output: 'pr_body', builtin: 'Write the PR body by docs/03-tickets.md'},
  {slot: 'critique', usedBy: 'critique', output: 'critique', builtinFile: 'skills/critique/SKILL.md', builtin: 'Score the captures against the verbatim brief on feel, readability, feedback and fidelity; rank findings as proposed tickets'},
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
  /** The plugin's root, where a slot's `builtinFile` lives. */
  pluginRoot?: string;
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

/** A directory of copied-in skills, where a skill sits at `<name>/SKILL.md` whatever its source layout. */
function isBareRoot(root: string): boolean {
  const [parent, leaf] = root.split(/[\\/]/).slice(-2);
  return parent === '.claude' && leaf === 'skills';
}

function resolveFile(file: string, env: ResolveEnv): {path: string | null; exists: boolean} {
  const exists = env.exists ?? existsSync;
  const candidates = isAbsolute(file) ? [file] : (env.roots ?? []).map(r => (isBareRoot(r) ? join(r, basename(dirname(file)), 'SKILL.md') : join(r, file)));
  const found = candidates.find(exists);
  return {path: found ?? candidates[0] ?? null, exists: found !== undefined};
}

/**
 * The built-in step of a slot as a file to read and follow, when the slot ships one and it is
 * present; otherwise the result unchanged, so the one-line step still runs. Pure given `exists`.
 */
export function withBuiltinFile<T extends ResolvedSlot>(slot: T, env: ResolveEnv = {}): T {
  if (slot.invoke !== 'builtin' || !slot.builtinFile || !env.pluginRoot) return slot;
  const path = join(env.pluginRoot, slot.builtinFile);
  return (env.exists ?? existsSync)(path) ? {...slot, invoke: 'file', path} : slot;
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
  const slots = SLOTS.map(def => withBuiltinFile(resolveSlot(def, mapping, have, env), env));
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

/**
 * The shipped flavours that map a skill collection, as presets: the first unconditional
 * candidate of each slot. Read straight from the files, so the packs layer does not import pipeline.
 */
export function loadPresets(pluginRoot: string): Preset[] {
  const dir = join(pluginRoot, 'flavours');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .flatMap((f): Preset[] => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as {
        name?: string;
        collection?: string;
        plugin?: string;
        aliases?: string[];
        forbid?: string[];
        description?: string;
        slots?: Record<string, Array<{skill?: string; file?: string; when?: unknown}>>;
      };
      if (typeof data.collection !== 'string') return [];
      const skills: Record<string, SkillMapping> = {};
      for (const [slot, candidates] of Object.entries(data.slots ?? {})) {
        const c = candidates.find(x => x.when === undefined);
        if (c?.skill) skills[slot] = c.skill;
        else if (c?.file) skills[slot] = {file: c.file};
      }
      return [
        {
          name: data.name ?? f.replace(/\.json$/, ''),
          collection: data.collection,
          ...(data.plugin ? {plugin: data.plugin} : {}),
          ...(data.aliases ? {aliases: data.aliases} : {}),
          ...(data.forbid ? {forbid: data.forbid} : {}),
          description: data.description ?? '',
          skills,
        },
      ];
    });
}

function skillDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true})
    .filter(e => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(dir, e.name, 'SKILL.md')))
    .map(e => e.name);
}

/** Directories holding skills: the conventional `skills/` plus a manifest `skills` string. */
function pluginSkillDirs(install: string): string[] {
  const m = readManifest(install);
  return [join(install, 'skills'), ...(typeof m.skills === 'string' ? [join(install, m.skills)] : [])];
}

/**
 * A plugin may list each skill directory in its manifest, nested under categories, so a skill
 * can live below `skills/<category>/`; the conventional scan alone would miss them.
 */
function manifestSkillPaths(install: string): string[] {
  const m = readManifest(install);
  return Array.isArray(m.skills) ? m.skills.filter((p): p is string => typeof p === 'string').map(p => join(install, p)) : [];
}

function readManifest(install: string): {skills?: unknown} {
  const file = join(install, '.claude-plugin', 'plugin.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as {skills?: unknown};
  } catch {
    return {};
  }
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
        for (const dir of pluginSkillDirs(install.installPath)) for (const name of skillDirs(dir)) out.add(`${plugin}:${name}`);
        for (const dir of manifestSkillPaths(install.installPath)) if (existsSync(join(dir, 'SKILL.md'))) out.add(`${plugin}:${basename(dir)}`);
      }
    }
  }
  return [...out].sort();
}

/** Install directories of the plugins Claude Code has recorded; a file slot's relative path is looked up under each. */
export function listCollectionRoots(home: string): string[] {
  const bare = join(home, '.claude', 'skills');
  const record = join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(record)) return [bare];
  try {
    const plugins = (JSON.parse(readFileSync(record, 'utf-8')) as {plugins?: Record<string, Array<{installPath?: string}>>}).plugins ?? {};
    return [...Object.values(plugins).flatMap(installs => installs.map(i => i.installPath).filter((p): p is string => !!p)), bare];
  } catch {
    return [bare];
  }
}
