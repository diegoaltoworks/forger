import {describe, expect, test} from 'bun:test';

import {claudeHarness, opencodeHarness} from '../../adapters';
import {DEFAULT_CONFIG} from '../../config';
import type {CommandRunner} from '../../ports';
import {readCatalogue} from './catalogue';
import {modelsGateRefusal, runModelsCheck} from './index';
import {modelsProblems, parseCatalogue, pickableModels} from './rules';

const config = (models: Record<string, string>, verifier: {model: string; budget: number} | null = null) => ({
  models,
  model_by_priority: {P0: {model: 'deep', budget: 1}, default: {model: 'standard', budget: 1}},
  verifier
});
const mapped = {fast: 'p/f', standard: 'p/s', deep: 'p/d'};

describe('modelsProblems', () => {
  test('a bare model name is a problem for a harness whose ids are provider/model, with the config key it came from', () => {
    const found = modelsProblems(config({deep: 'opus', standard: 'p/s'}), opencodeHarness, null);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('model-form');
    expect(found[0].detail).toContain('model_by_priority.P0.model');
    expect(found[0].detail).toContain('"opus"');
    expect(found[0].detail).toContain('provider/model');
    expect(found[0].detail).toContain('opencode models');
  });

  test('a role mapped under models to a provider/model id is no problem', () => {
    expect(modelsProblems(config(mapped), opencodeHarness, null)).toEqual([]);
    expect(modelsProblems(config({deep: 'a/b', standard: 'a/c'}, {model: 'a/v', budget: 1}), opencodeHarness, ['a/b', 'a/c', 'a/v'])).toEqual([]);
  });

  test('a model that is not in the catalogue read is a problem that names the model and the listing command', () => {
    const found = modelsProblems(config(mapped, {model: 'p/gone', budget: 1}), opencodeHarness, ['p/s', 'p/d']);
    expect(found.map(f => f.rule)).toEqual(['model-unlisted']);
    expect(found[0].detail).toContain('verifier.model');
    expect(found[0].detail).toContain('"p/gone"');
    expect(found[0].detail).toContain('opencode models');
  });

  test('a harness that says nothing about models has no problem', () => {
    expect(modelsProblems({models: DEFAULT_CONFIG.models, model_by_priority: DEFAULT_CONFIG.model_by_priority, verifier: null}, claudeHarness, ['x'])).toEqual([]);
    expect(modelsProblems(config({}), undefined, null)).toEqual([]);
  });
});

describe('the models gate pieces', () => {
  test('pickableModels resolves roles and keeps literal ids', () => {
    expect(pickableModels(config({deep: 'p/d'}, {model: 'lit/x', budget: 1})).map(m => m.id)).toEqual(['p/d', 'standard', 'lit/x']);
  });

  test('parseCatalogue keeps one id per line', () => {
    expect(parseCatalogue('a/b\n\n  c/d  \n')).toEqual(['a/b', 'c/d']);
  });

  test('runModelsCheck reads no catalogue', () => {
    expect(runModelsCheck(config({deep: 'p/d', standard: 'p/s'}) as never, opencodeHarness)).toEqual([]);
  });

  test('the refusal quotes each problem', () => {
    expect(modelsGateRefusal([])).toBeNull();
    const text = modelsGateRefusal(modelsProblems(config({}), opencodeHarness, null));
    expect(text).toContain('models gate fails');
    expect(text).toContain('check models');
  });
});

describe('readCatalogue', () => {
  test('a catalogue command that cannot run is logged and the start goes on', () => {
    const lines: string[] = [];
    const run: CommandRunner = () => {
      throw new Error('opencode: not found');
    };
    expect(readCatalogue(opencodeHarness, run, l => lines.push(l))).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('opencode models');
    expect(modelsProblems(config(mapped), opencodeHarness, null)).toEqual([]);
  });

  test('a listing is read through the runner, and a harness with none runs nothing', () => {
    const calls: string[] = [];
    const run: CommandRunner = c => (calls.push(c), 'p/s\np/d\n');
    expect(readCatalogue(opencodeHarness, run)).toEqual(['p/s', 'p/d']);
    expect(readCatalogue(claudeHarness, run)).toBeNull();
    expect(calls).toEqual(['opencode models']);
  });
});
