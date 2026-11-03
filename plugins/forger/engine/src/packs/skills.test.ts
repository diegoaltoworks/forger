import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

import {formatSkills, listInstalledSkills, loadPresets, offerPresets, resolveSkills, SLOTS, type Preset} from './skills';

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
    expect(r.slots.every(s => s.skill === null && !s.installed && s.use === 'builtin')).toBe(true);
    expect(r.slots.every(s => s.builtin !== '')).toBe(true);
  });
  test('the design slot resolves to its built-in step when unmapped', () => {
    const s = resolveSkills({}, []).slots.find(x => x.slot === 'design')!;
    expect(s).toMatchObject({usedBy: 'plan', skill: null, use: 'builtin'});
    expect(s.builtin).toContain('screenshot --wireframe');
  });
  test('a mapped and installed skill is used', () => {
    const s = resolveSkills({review: 'coll:code-review'}, ['coll:code-review']).slots.find(x => x.slot === 'review')!;
    expect(s).toMatchObject({skill: 'coll:code-review', installed: true, use: 'skill'});
  });
  test('a mapped skill that is not installed falls back to the built-in step', () => {
    const s = resolveSkills({review: 'coll:code-review'}, ['other:thing']).slots.find(x => x.slot === 'review')!;
    expect(s).toMatchObject({skill: 'coll:code-review', installed: false, use: 'builtin'});
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

describe('offerPresets', () => {
  const preset = (name: string, collection: string): Preset => ({name, collection, description: 'd', skills: {review: `${collection}:r`}});
  test('offers a preset whose collection has an installed skill', () => {
    expect(offerPresets([preset('a', 'a'), preset('b', 'b')], ['b:x']).map(p => p.name)).toEqual(['b']);
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
      expect(Object.values(p.skills).every(v => v.startsWith(`${p.collection}:`))).toBe(true);
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
