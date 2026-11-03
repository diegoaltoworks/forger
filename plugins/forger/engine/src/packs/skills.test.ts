import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

import {collectionInstalled, formatSkills, listInstalledSkills, loadPresets, offerPresets, resolveSkills, SLOTS, UNATTENDED_PREAMBLE, type Preset} from './skills';

const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'forger-skills-'));
  dirs.push(d);
  return d;
}
function skill(dir: string, name: string): void {
  mkdirSync(join(dir, name), {recursive: true});
  writeFileSync(join(dir, name, 'SKILL.md'), '---\nname: x\n---\n');
}

describe('resolveSkills', () => {
  test('reports every slot, unmapped ones on the built-in step', () => {
    const r = resolveSkills({}, []);
    expect(r.slots.map(s => s.slot)).toEqual(SLOTS.map(s => s.slot));
    expect(r.slots.every(s => s.skill === null && !s.installed && s.invoke === 'builtin')).toBe(true);
    expect(r.slots.every(s => s.builtin !== '')).toBe(true);
  });
  test('the design slot resolves to its built-in step when unmapped', () => {
    const s = resolveSkills({}, []).slots.find(x => x.slot === 'design')!;
    expect(s).toMatchObject({usedBy: 'plan', skill: null, invoke: 'builtin'});
    expect(s.builtin).toContain('screenshot --wireframe');
  });
  test('a mapped and installed skill is used', () => {
    const s = resolveSkills({review: 'coll:code-review'}, ['coll:code-review']).slots.find(x => x.slot === 'review')!;
    expect(s).toMatchObject({skill: 'coll:code-review', installed: true, invoke: 'skill'});
  });
  test('a mapped skill that is not installed falls back to the built-in step', () => {
    const s = resolveSkills({review: 'coll:code-review'}, ['other:thing']).slots.find(x => x.slot === 'review')!;
    expect(s).toMatchObject({skill: 'coll:code-review', installed: false, invoke: 'builtin'});
  });
  test('a blank mapping is unmapped', () => {
    expect(resolveSkills({review: '  '}, []).slots.find(x => x.slot === 'review')!.skill).toBeNull();
  });
  test('keys that are not slots are reported', () => {
    expect(resolveSkills({reveiw: 'a:b', review: 'a:b'}, []).unknown).toEqual(['reveiw']);
  });
  test('the text form names the resolution per slot', () => {
    const text = formatSkills(resolveSkills({review: 'c:r'}, ['c:r']));
    expect(text).toContain('review');
    expect(text).toContain('c:r (installed)');
    expect(text).toContain('unmapped');
  });
});

describe('file slots', () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);
  const slot = (r: ReturnType<typeof resolveSkills>, name: string) => r.slots.find(x => x.slot === name)!;
  test('a file slot that exists is invoked as a file, with its resolved path', () => {
    const r = resolveSkills({review: {file: 'skills/review/SKILL.md'}}, [], {roots: ['/a', '/b'], exists: exists(['/b/skills/review/SKILL.md'])});
    expect(slot(r, 'review')).toMatchObject({invoke: 'file', installed: true, path: '/b/skills/review/SKILL.md', skill: null, file: 'skills/review/SKILL.md'});
  });
  test('a file slot whose file is missing uses the built-in step and still reports the path', () => {
    const r = resolveSkills({review: {file: 'skills/review/SKILL.md'}}, [], {roots: ['/a'], exists: exists([])});
    expect(slot(r, 'review')).toMatchObject({invoke: 'builtin', installed: false, path: '/a/skills/review/SKILL.md'});
  });
  test('an absolute file is used as it is', () => {
    const r = resolveSkills({review: {file: '/x/SKILL.md'}}, [], {exists: exists(['/x/SKILL.md'])});
    expect(slot(r, 'review')).toMatchObject({invoke: 'file', path: '/x/SKILL.md'});
  });
  test('a relative file with no root has no path', () => {
    expect(slot(resolveSkills({review: {file: 'a/SKILL.md'}}, []), 'review')).toMatchObject({invoke: 'builtin', path: null});
  });
  test('a name slot is invoked as a skill and has no path', () => {
    const r = resolveSkills({review: 'c:r'}, ['c:r']);
    expect(slot(r, 'review')).toMatchObject({invoke: 'skill', path: null, file: null});
  });
});

describe('prefixed and unprefixed installs', () => {
  const preset: Preset = {name: 'c', collection: 'c', aliases: ['tdd', 'review'], forbid: ['c:implement'], description: 'd', skills: {test_first: 'c:tdd'}};
  test('a prefixed install resolves by the mapped name', () => {
    const r = resolveSkills({test_first: 'c:tdd'}, ['c:tdd'], {presets: [preset]});
    expect(r.slots.find(s => s.slot === 'test_first')).toMatchObject({skill: 'c:tdd', invoke: 'skill'});
  });
  test('an unprefixed install resolves to the bare name', () => {
    const r = resolveSkills({test_first: 'c:tdd'}, ['tdd'], {presets: [preset]});
    expect(r.slots.find(s => s.slot === 'test_first')).toMatchObject({skill: 'tdd', installed: true, invoke: 'skill'});
  });
  test('a bare name that is not a declared alias does not resolve', () => {
    const r = resolveSkills({test_first: 'c:other'}, ['other'], {presets: [preset]});
    expect(r.slots.find(s => s.slot === 'test_first')).toMatchObject({invoke: 'builtin'});
  });
  test('the collection is detected either way, and its forbid list is reported', () => {
    expect(collectionInstalled(preset, ['c:x'])).toBe(true);
    expect(collectionInstalled(preset, ['tdd'])).toBe(true);
    expect(collectionInstalled(preset, ['zzz'])).toBe(false);
    expect(resolveSkills({}, ['tdd'], {presets: [preset]}).forbid).toEqual(['c:implement']);
    expect(resolveSkills({}, ['zzz'], {presets: [preset]}).forbid).toEqual([]);
  });
  test('the plugin name is a prefix too', () => {
    expect(collectionInstalled({...preset, plugin: 'plug'}, ['plug:x'])).toBe(true);
  });
});

describe('unattended preamble', () => {
  test('is one string that forbids asking, committing and routing, and is reported with the slots', () => {
    expect(UNATTENDED_PREAMBLE).not.toContain('\n');
    for (const rule of ['never ask the owner', 'decline', 'Do not commit, push, merge or open pull requests', 'Do not route to another skill']) {
      expect(UNATTENDED_PREAMBLE).toContain(rule);
    }
    expect(resolveSkills({}, []).preamble).toBe(UNATTENDED_PREAMBLE);
  });
});

describe('offerPresets', () => {
  const preset = (name: string, collection: string): Preset => ({name, collection, description: 'd', skills: {review: `${collection}:r`}});
  test('offers a preset whose collection has an installed skill', () => {
    expect(offerPresets([preset('a', 'a'), preset('b', 'b')], ['b:x']).map(p => p.name)).toEqual(['b']);
  });
  test('offers a preset for an unprefixed install through its aliases', () => {
    expect(offerPresets([{...preset('a', 'a'), aliases: ['tdd']}], ['tdd']).map(p => p.name)).toEqual(['a']);
  });
  test('does not match a collection by prefix of another name', () => {
    expect(offerPresets([preset('a', 'a')], ['ab:x'])).toEqual([]);
  });
});

describe('shipped presets', () => {
  test('every preset maps only real slots', () => {
    const slots = new Set(SLOTS.map(s => s.slot));
    const presets = loadPresets(PLUGIN_ROOT);
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) {
      expect(Object.keys(p.skills).every(k => slots.has(k))).toBe(true);
      expect(Object.values(p.skills).every(v => typeof v === 'string' && v.startsWith(`${p.collection}:`))).toBe(true);
    }
  });
  test('every alias is a skill the preset maps, and forbidden skills are not mapped', () => {
    for (const p of loadPresets(PLUGIN_ROOT)) {
      const mapped = Object.values(p.skills).filter((v): v is string => typeof v === 'string');
      for (const v of mapped) expect(p.aliases ?? []).toContain(v.slice(v.indexOf(':') + 1));
      for (const f of p.forbid ?? []) expect(mapped).not.toContain(f);
    }
  });
  test('the collection example is present', () => {
    expect(loadPresets(PLUGIN_ROOT).map(p => p.name)).toContain('mattpocock-skills');
  });
});

describe('listInstalledSkills', () => {
  test('finds plugin, user and project skills', () => {
    const home = tmp();
    const project = tmp();
    const install = join(home, 'cache', 'coll');
    skill(join(install, 'skills'), 'grilling');
    mkdirSync(join(home, '.claude', 'plugins'), {recursive: true});
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({plugins: {'coll@market': [{installPath: install}]}})
    );
    skill(join(home, '.claude', 'skills'), 'mine');
    skill(join(project, '.claude', 'skills'), 'local');
    mkdirSync(join(install, 'skills', 'not-a-skill'), {recursive: true});
    expect(listInstalledSkills(home, project)).toEqual(['coll:grilling', 'local', 'mine']);
  });
  test('nothing installed, or an unreadable record, is empty', () => {
    const home = tmp();
    expect(listInstalledSkills(home, tmp())).toEqual([]);
    mkdirSync(join(home, '.claude', 'plugins'), {recursive: true});
    writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), '{nope');
    expect(listInstalledSkills(home, tmp())).toEqual([]);
  });
});
