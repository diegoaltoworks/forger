import {describe, expect, test} from 'bun:test';
import {existsSync, readFileSync} from 'fs';
import {join, resolve} from 'path';

import {loadDefinition, resolvePipeline, NO_TICKET, loadFlavour, CONTRACT_FOR_SLOT} from '../pipeline';
import {resolveSkills, SLOTS} from './skills';

const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');
const SHIPPED = ['test_first', 'review', 'diagnose', 'prototype'];

function plan(env: {exists?: (p: string) => boolean}) {
  return resolvePipeline(loadDefinition(PLUGIN_ROOT), undefined, loadFlavour(PLUGIN_ROOT, '/nonexistent', 'default'), {}, [], NO_TICKET, {pluginRoot: PLUGIN_ROOT, roots: [PLUGIN_ROOT], ...env});
}

describe('forger own skill files', () => {
  test.each(SHIPPED)('%s has its steps, red flags, exit criteria and names its contract', slot => {
    const def = SLOTS.find(s => s.slot === slot);
    expect(def?.builtinFile).toBe(`skills/${slot}/SKILL.md`);
    const text = readFileSync(join(PLUGIN_ROOT, def!.builtinFile!), 'utf-8');
    for (const h of ['## Steps', '## Red flags', '## Exit criteria', '## Contract']) expect(text).toContain(h);
    expect(text).toContain(`\`${CONTRACT_FOR_SLOT[slot]}\``);
    expect(text).toContain(`name: ${slot}`);
  });

  test('skills report the file for those slots and the line for the rest', () => {
    const report = resolveSkills({}, [], {pluginRoot: PLUGIN_ROOT});
    for (const s of report.slots) {
      if (SHIPPED.includes(s.slot)) expect(s).toMatchObject({invoke: 'file', path: join(PLUGIN_ROOT, `skills/${s.slot}/SKILL.md`)});
      else expect(s.invoke).toBe('builtin');
    }
  });

  test('a missing file falls back to the one-line step', () => {
    const report = resolveSkills({}, [], {pluginRoot: PLUGIN_ROOT, exists: () => false});
    expect(report.slots.filter(s => s.invoke === 'file')).toEqual([]);
  });

  test('the pipeline reports the file, and the line when it is missing', () => {
    const slots = plan({}).stages.flatMap(s => s.slots);
    for (const slot of SHIPPED) {
      const p = slots.find(s => s.slot === slot);
      expect(p).toMatchObject({invoke: 'file', target: join(PLUGIN_ROOT, `skills/${slot}/SKILL.md`)});
      expect(existsSync(p!.target!)).toBe(true);
    }
    const gone = plan({exists: () => false}).stages.flatMap(s => s.slots);
    for (const slot of SHIPPED) expect(gone.find(s => s.slot === slot)).toMatchObject({invoke: 'builtin', target: SLOTS.find(d => d.slot === slot)!.builtin});
  });

  test('a project mapping still wins over the file', () => {
    const r = resolveSkills({review: 'tdd:review'}, ['tdd:review'], {pluginRoot: PLUGIN_ROOT});
    expect(r.slots.find(s => s.slot === 'review')).toMatchObject({invoke: 'skill', skill: 'tdd:review'});
  });
});
