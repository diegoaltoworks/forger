import {mkdtempSync, mkdirSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {describe, expect, test} from 'bun:test';

import {parseDeliverConfig, planDelivery} from './config';
import {runDeliveryCheck} from './run';

const configOf = (obj: unknown) => {
  const {config, findings} = parseDeliverConfig(JSON.stringify(obj));
  if (!config) throw new Error(JSON.stringify(findings));
  return config;
};

describe('parseDeliverConfig', () => {
  test('a deliver file with no check command is a finding', () => {
    const {config, findings} = parseDeliverConfig(JSON.stringify({deploy: 'ship'}));
    expect(config).toBeNull();
    expect(findings.map(f => f.opinion)).toEqual(['delivery.checked-after-merge']);
  });

  test.each([
    ['not json', 'not valid JSON'],
    ['[]', 'must be an object'],
    [JSON.stringify({check: ' '}), '"check" must be'],
    [JSON.stringify({check: 'c', deploy: 3}), '"deploy" must be'],
    [JSON.stringify({check: 'c', rollback: ''}), '"rollback" must be'],
    [JSON.stringify({check: 'c', timeout_seconds: 5}), 'keyed by step'],
    [JSON.stringify({check: 'c', timeout_seconds: {check: 0}}), 'positive number'],
    [JSON.stringify({check: 'c', timeout_seconds: {check: 'x'}}), 'positive number'],
    [JSON.stringify({check: 'c', timeout_seconds: {build: 5}}), 'names no step'],
  ])('rejects %s', (text, message) => {
    const {config, findings} = parseDeliverConfig(text);
    expect(config).toBeNull();
    expect(findings.map(f => f.detail).join('\n')).toContain(message);
  });

  test('defaults and trims', () => {
    const c = configOf({check: ' c ', timeout_seconds: {check: 9}});
    expect(c).toEqual({check: 'c', timeout_seconds: {deploy: 300, check: 9, rollback: 300}});
  });
});

describe('runDeliveryCheck', () => {
  const projectWith = (text?: string) => {
    const root = mkdtempSync(join(tmpdir(), 'deliver-'));
    if (text !== undefined) {
      mkdirSync(join(root, '.forger'));
      writeFileSync(join(root, '.forger', 'deliver.json'), text);
    }
    return root;
  };

  test('a valid deliver file is no finding and no command is run', () => {
    const marker = join(tmpdir(), `deliver-ran-${process.pid}`);
    const root = projectWith(JSON.stringify({deploy: `touch ${marker}`, check: `touch ${marker}`, rollback: `touch ${marker}`}));
    expect(runDeliveryCheck(root)).toEqual([]);
    expect(require('fs').existsSync(marker)).toBe(false);
  });

  test('reports the findings of an invalid file', () => {
    expect(runDeliveryCheck(projectWith('{}')).length).toBe(1);
  });

  test('a missing file is an error', () => {
    expect(() => runDeliveryCheck(projectWith())).toThrow('not found');
  });
});

describe('planDelivery', () => {
  test('the plan runs deploy then check when both are configured', () => {
    const plan = planDelivery(configOf({deploy: 'd', check: 'c'}));
    expect(plan.steps.map(s => [s.name, s.command])).toEqual([['deploy', 'd'], ['check', 'c']]);
  });

  test('the plan is the check alone with no deploy', () => {
    expect(planDelivery(configOf({check: 'c'})).steps.map(s => s.name)).toEqual(['check']);
  });

  test('a failed check plans the rollback only when one is configured', () => {
    const without = planDelivery(configOf({check: 'c'}));
    expect(without.onFailure('check')).toBeNull();
    const withRollback = planDelivery(configOf({check: 'c', rollback: 'r', timeout_seconds: {rollback: 7}}));
    expect(withRollback.onFailure('check')).toEqual({name: 'rollback', command: 'r', timeout_seconds: 7});
    expect(withRollback.onFailure('deploy')?.name).toBe('rollback');
    expect(withRollback.onFailure('rollback')).toBeNull();
  });
});
