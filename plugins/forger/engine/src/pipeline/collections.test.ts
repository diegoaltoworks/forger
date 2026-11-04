import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {listCollectionRoots, listInstalledSkills, loadPresets, offerPresets} from '../packs';
import {loadDefinition, shippedFlavour} from './load';
import {resolvePipeline, type PlannedSlot} from './resolve';
import {NO_TICKET, type Flavour} from './types';

const PLUGIN_ROOT = join(import.meta.dir, '..', '..', '..');
const definition = loadDefinition(PLUGIN_ROOT);

/** Each collection's skill directories, laid out as the collection ships them. */
const MATTPOCOCK = [
  'engineering/ask-matt',
  'engineering/code-review',
  'engineering/diagnosing-bugs',
  'engineering/domain-modeling',
  'engineering/implement',
  'engineering/implement-spec',
  'engineering/pr',
  'engineering/retro',
  'engineering/tdd',
  'engineering/to-spec',
  'engineering/to-tickets',
  'engineering/triage',
  'engineering/wayfinder',
  'productivity/grilling',
];
const AGENT_SKILLS = [
  'code-review-and-quality',
  'debugging-and-error-recovery',
  'doubt-driven-development',
  'documentation-and-adrs',
  'interview-me',
  'security-and-hardening',
  'test-driven-development',
  'using-agent-skills',
];
const PSTACK = ['blast-radius', 'interrogate', 'poteto-mode', 'reflect', 'tdd'];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'forger-collections-'));
  dirs.push(d);
  return d;
}
function skillAt(dir: string): void {
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: x\n---\n');
}

/** A home whose plugin record installs the three collections; `bare` copies skills in without a prefix instead. */
function home(mode: 'plugin' | 'bare'): string {
  const h = tmp();
  const plugins: Record<string, Array<{installPath: string}>> = {};
  const install = (key: string, names: string[], manifest: unknown, nested: boolean): void => {
    const root = join(h, 'cache', key);
    for (const n of names) skillAt(join(root, 'skills', n));
    if (manifest !== undefined) {
      mkdirSync(join(root, '.claude-plugin'), {recursive: true});
      writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest));
    }
    if (mode === 'plugin') plugins[`${key}@market`] = [{installPath: root}];
    else for (const n of names) skillAt(join(h, '.claude', 'skills', nested ? n.split('/').pop() ?? n : n));
  };
  install('mattpocock-skills', MATTPOCOCK, {skills: MATTPOCOCK.map(n => `./skills/${n}`)}, true);
  install('agent-skills', AGENT_SKILLS, {skills: './skills'}, false);
  install('pstack', PSTACK, undefined, false);
  mkdirSync(join(h, '.claude', 'plugins'), {recursive: true});
  writeFileSync(join(h, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({plugins}));
  return h;
}

function plan(flavour: Flavour, h: string, labels: string[] = []): Map<string, PlannedSlot> {
  const out = resolvePipeline(definition, undefined, flavour, {}, listInstalledSkills(h, tmp()), {...NO_TICKET, id: 'issue-1', labels}, {roots: listCollectionRoots(h), presets: loadPresets(PLUGIN_ROOT)});
  const slots = new Map<string, PlannedSlot>();
  for (const st of out.stages) for (const s of st.slots) slots.set(s.slot, s);
  return slots;
}

const flavour = (name: string): Flavour => shippedFlavour(PLUGIN_ROOT, name) as Flavour;

describe('the shipped collection flavours against a fixture of each collection', () => {
  test('every skill and file a flavour names exists in the collections laid out as shipped', () => {
    const h = home('plugin');
    const have = new Set(listInstalledSkills(h, tmp()));
    const roots = listCollectionRoots(h);
    const missing: string[] = [];
    for (const name of ['agent-skills', 'mattpocock-skills', 'pstack', 'mixed']) {
      const f = flavour(name);
      for (const [slot, list] of Object.entries(f.slots)) {
        for (const c of list) {
          if (c.skill !== undefined && !have.has(c.skill)) missing.push(`${name}.${slot}: ${c.skill}`);
          if (c.file !== undefined && !roots.some(r => existsSync(join(r, c.file as string)))) missing.push(`${name}.${slot}: ${c.file}`);
        }
      }
      for (const forbidden of f.forbid ?? []) if (!have.has(forbidden)) missing.push(`${name}.forbid: ${forbidden}`);
    }
    expect(missing).toEqual([]);
  });

  test.each([['agent-skills'], ['mattpocock-skills']])('%s is offered when its collection is installed, prefixed or not', name => {
    for (const mode of ['plugin', 'bare'] as const) {
      const installed = listInstalledSkills(home(mode), tmp());
      expect(offerPresets(loadPresets(PLUGIN_ROOT), installed).map(p => p.name)).toContain(name);
    }
  });

  test('pstack is offered when installed as a plugin or copied in bare', () => {
    for (const mode of ['plugin', 'bare'] as const) {
      expect(offerPresets(loadPresets(PLUGIN_ROOT), listInstalledSkills(home(mode), tmp())).map(p => p.name)).toContain('pstack');
    }
  });

  test.each([['agent-skills'], ['mattpocock-skills'], ['pstack'], ['mixed']])('%s resolves a skill or file for its slots with and without the prefix', name => {
    for (const mode of ['plugin', 'bare'] as const) {
      const slots = plan(flavour(name), home(mode));
      const filled = [...slots.values()].filter(s => s.invoke !== 'builtin').map(s => s.slot);
      expect(filled.length).toBeGreaterThan(0);
      expect([...filled].sort()).toEqual(Object.keys(flavour(name).slots).filter(k => slots.has(k)).sort());
    }
  });

  test('agent-skills resolves to skills with the prefix and without it', () => {
    for (const mode of ['plugin', 'bare'] as const) {
      const slots = plan(flavour('agent-skills'), home(mode));
      expect(slots.get('test_first')).toMatchObject({invoke: 'skill'});
      expect(slots.get('review')).toMatchObject({invoke: 'skill'});
      expect(slots.get('risk')).toMatchObject({invoke: 'skill'});
      expect(slots.get('pr_body')).toMatchObject({invoke: 'builtin'});
    }
  });

  test('mattpocock-skills fills pr_body by skill and retro by file', () => {
    const slots = plan(flavour('mattpocock-skills'), home('plugin'));
    expect(slots.get('pr_body')).toMatchObject({invoke: 'skill'});
    expect(slots.get('retro')).toMatchObject({invoke: 'file'});
    expect(slots.get('risk')).toMatchObject({invoke: 'builtin'});
  });

  test('pstack fills every slot by file', () => {
    const slots = plan(flavour('pstack'), home('plugin'));
    for (const slot of ['test_first', 'review', 'risk', 'retro']) expect(slots.get(slot)).toMatchObject({invoke: 'file'});
    expect(slots.get('interview')).toMatchObject({invoke: 'builtin'});
  });

  test('mixed takes the strongest fit per slot, and security tickets get the hardening skill', () => {
    const h = home('plugin');
    const plain = plan(flavour('mixed'), h);
    expect(plain.get('interview')?.target).toBe('mattpocock-skills:grilling');
    expect(plain.get('review')?.target).toBe('agent-skills:code-review-and-quality');
    expect(plain.get('risk')).toMatchObject({invoke: 'file'});
    expect(plain.get('retro')).toMatchObject({invoke: 'file'});
    expect(plan(flavour('mixed'), h, ['security']).get('risk')?.target).toBe('agent-skills:security-and-hardening');
  });

  test('mixed falls through to the built-in step where no collection is installed', () => {
    const slots = plan(flavour('mixed'), tmp());
    for (const s of slots.values()) expect(s.invoke).toBe('builtin');
  });
});
