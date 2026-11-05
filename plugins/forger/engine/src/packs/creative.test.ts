import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

import {loadDefinition, loadFlavour, NO_TICKET, resolvePipeline} from '../pipeline';
import {detectPacks, type RepoFacts} from './detect';
import {listOpinions, loadPacks, parseLock} from './packs';
import {runSetup} from './setup';

const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');
const facts = (f: Partial<RepoFacts>): RepoFacts => ({files: [], dirs: [], deps: [], ...f});
const available = loadPacks(PLUGIN_ROOT);
const noLock = {packs: []};
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

describe('creative pack detection', () => {
  test('a game repo gets creative recommended, with the dependency as the reason', () => {
    const got = detectPacks(available, noLock, facts({files: ['index.html'], deps: ['phaser', 'vite']}));
    expect(got.find(s => s.id === 'creative')?.reasons).toEqual(['dep:phaser']);
  });

  test('a CRUD app does not', () => {
    const got = detectPacks(available, noLock, facts({files: ['index.html'], deps: ['react', 'express', 'pg']}));
    expect(got.map(s => s.id)).toContain('ui');
    expect(got.map(s => s.id)).not.toContain('creative');
  });
});

describe('creative pack setup', () => {
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'forger-creative-'));
    dirs.push(root);
    return {root, result: runSetup(root, PLUGIN_ROOT, {packs: ['base', 'creative']})};
  }

  test('installs its templates and opinions, records them in the lock and never overwrites', () => {
    const {root, result} = setup();
    for (const p of ['.forger/opinions/creative.md', '.forger/templates/ticket-creative.md', 'docs/design/style-frame/index.html']) {
      expect(result.files.find(f => f.path === p)?.action).toBe('written');
    }
    const lock = parseLock(readFileSync(join(root, '.forger', 'forger.lock.json'), 'utf-8'));
    expect(lock.packs.find(p => p.id === 'creative')?.files.map(f => f.path)).toContain('.forger/templates/ticket-creative.md');
    const again = runSetup(root, PLUGIN_ROOT, {packs: ['base', 'creative']});
    expect(again.files.filter(f => f.path.includes('creative') || f.path.includes('style-frame')).every(f => f.action === 'kept')).toBe(true);
  });

  test('the installed ticket template carries the four sections beside the base ones', () => {
    const {root} = setup();
    const text = readFileSync(join(root, '.forger', 'templates', 'ticket-creative.md'), 'utf-8');
    const base = readFileSync(join(root, '.forger', 'templates', 'ticket.md'), 'utf-8');
    for (const h of ['## Brief fit', '## Juice', '## Readable at a glance']) expect(text).toContain(h);
    expect(text).toContain('time-to-first-interaction');
    for (const h of base.match(/^## .+$/gm) ?? []) expect(text).toContain(h);
  });
});

describe('creative pack opinions', () => {
  test('each is listed with its rung once installed', () => {
    const lock = {packs: [{id: 'creative', version: '1.0.0', files: []}]};
    const got = listOpinions(available, lock as never).filter(o => o.id.startsWith('creative.'));
    expect(got.map(o => o.id)).toEqual(expect.arrayContaining(['creative.style-frame', 'creative.brief-fit', 'creative.juice', 'creative.glanceable', 'creative.palette-tokens', 'creative.no-style-locking-tests', 'creative.reduced-motion', 'creative.original']));
    expect(got.every(o => ['template', 'rule'].includes(o.rung))).toBe(true);
  });
});

describe('the design slot', () => {
  const designFor = (flavour: string) => {
    const plan = resolvePipeline(loadDefinition(PLUGIN_ROOT), undefined, loadFlavour(PLUGIN_ROOT, '/nonexistent', flavour), {}, [], {...NO_TICKET, labels: ['ui']}, {pluginRoot: PLUGIN_ROOT, roots: [PLUGIN_ROOT]});
    return plan.stages.flatMap(s => s.slots).find(s => s.slot === 'design')!;
  };

  test('resolves to the style-frame step under the creative flavour', () => {
    const d = designFor('creative');
    expect(d).toMatchObject({invoke: 'file', target: join(PLUGIN_ROOT, 'skills/style-frame/SKILL.md')});
    expect(existsSync(d.target!)).toBe(true);
  });

  test('resolves to the grey wireframe otherwise', () => {
    const d = designFor('default');
    expect(d.invoke).toBe('builtin');
    expect(d.target).toContain('grey-box');
  });

  test('the style-frame skill names its steps, red flags, exit criteria and contract', () => {
    const text = readFileSync(join(PLUGIN_ROOT, 'skills/style-frame/SKILL.md'), 'utf-8');
    for (const h of ['## Steps', '## Red flags', '## Exit criteria', '## Contract', 'name: style-frame', '`wireframe`']) expect(text).toContain(h);
  });
});
