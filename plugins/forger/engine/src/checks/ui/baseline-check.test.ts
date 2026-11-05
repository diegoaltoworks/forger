import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {encodePng, parseUiConfig, type DecodedPng} from '../../ui';
import {runBaselineCheck} from './baseline-check';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const config = parseUiConfig(JSON.stringify({paths: ['src/**'], start: 's'}));
const FILE = 'docs/screenshots/cart-phone-light.png';

function solid(size: number, v: number): DecodedPng {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([v, v, v, 255], i * 4);
  return {width: size, height: size, data};
}

function project(baseline: DecodedPng | null, capture: DecodedPng | null, manifest = true): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-baseline-'));
  dirs.push(root);
  for (const d of ['.forger/ui-baselines', 'docs/screenshots']) mkdirSync(join(root, d), {recursive: true});
  if (manifest) writeFileSync(join(root, '.forger/ui-baselines/approved.json'), JSON.stringify({approved: [{name: 'cart', approved_by: 'owner', files: [FILE]}]}));
  if (baseline) writeFileSync(join(root, '.forger/ui-baselines/cart-phone-light.png'), encodePng(baseline));
  if (capture) writeFileSync(join(root, FILE), encodePng(capture));
  return root;
}

describe('runBaselineCheck', () => {
  test('no manifest means nothing is approved and nothing fails', () => {
    expect(runBaselineCheck(project(null, solid(20, 5), false), config)).toEqual([]);
  });

  test('a capture matching its baseline passes and writes no diff', () => {
    const root = project(solid(20, 5), solid(20, 5));
    expect(runBaselineCheck(root, config)).toEqual([]);
    expect(existsSync(join(root, 'docs/screenshots/cart-phone-light.diff.png'))).toBe(false);
  });

  test('a changed capture fails and the diff image lands next to it', () => {
    const root = project(solid(20, 5), solid(20, 200));
    const findings = runBaselineCheck(root, config);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({file: FILE, rule: 'baseline_changed', opinion: 'ui.baselines'});
    expect(findings[0].detail).toContain('only the owner re-approves');
    expect(existsSync(join(root, 'docs/screenshots/cart-phone-light.diff.png'))).toBe(true);
  });

  test('an approved state with no capture, or no baseline image, fails', () => {
    expect(runBaselineCheck(project(solid(20, 5), null), config)[0].rule).toBe('capture_missing');
    expect(runBaselineCheck(project(null, solid(20, 5)), config)[0].rule).toBe('baseline_missing');
  });
});
