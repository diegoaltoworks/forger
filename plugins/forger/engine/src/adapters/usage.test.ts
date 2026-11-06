import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import {codexHarness} from './codex';
import {copilotHarness} from './copilot';
import {hostSandbox} from './host-sandbox';
import {agentFor, spendLimitOf} from './harnesses';
import {opencodeHarness} from './opencode';
import {claudeHarness} from './claude';

const noGit = () => ({stdout: '', stderr: '', exitCode: 1});
const sample = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');
const price = {input: 2, output: 8, cached_input: 0.5};

describe('usage from a recorded sample', () => {
  test('each adapter that reports usage parses spend from a recorded sample of its output: opencode states cost', () => {
    expect(opencodeHarness.spentUsd!(sample('opencode-run.jsonl'))).toBeCloseTo(0.02, 6);
  });
  test('each adapter that reports usage parses spend from a recorded sample of its output: codex states tokens, priced from the config', () => {
    // turn 1: 600k fresh x 2 + 400k cached x 0.5 + 100k out x 8 = 1.2 + 0.2 + 0.8; turn 2: 1M cached x 0.5
    expect(codexHarness.spentUsd!(sample('codex-exec.jsonl'), price)).toBeCloseTo(2.7, 6);
  });
  test('spend is null before any step has finished', () => {
    expect(opencodeHarness.spentUsd!('{"type":"step_start"}\n')).toBeNull();
    expect(codexHarness.spentUsd!('{"type":"turn.started"}\n', price)).toBeNull();
  });
  test('the worker words are decoded from the stream so the claim can be read', () => {
    expect(codexHarness.plainText!(sample('codex-exec.jsonl'))).toContain('Gates are green.\n<process>complete</process>');
    expect(opencodeHarness.plainText!(sample('opencode-run.jsonl'))).toContain('<process>complete</process>');
  });
});

describe('which runs have a spend limit', () => {
  test('a token-only harness with no price configured runs with no spend limit', () => {
    expect(codexHarness.spentUsd!(sample('codex-exec.jsonl'))).toBeNull();
    expect(spendLimitOf(codexHarness, 'gpt-5', {})).toBe('none');
    expect(spendLimitOf(codexHarness, 'gpt-5', {'gpt-5': price})).toBe('engine');
  });
  test('a harness that states cost, or caps itself, needs no price', () => {
    expect(spendLimitOf(opencodeHarness, 'p/m')).toBe('engine');
    expect(spendLimitOf(claudeHarness, 'sonnet')).toBe('harness');
  });
  test('a run in a harness with no usage has no spend limit', () => {
    expect(spendLimitOf(copilotHarness, 'gpt-5', {'gpt-5': price})).toBe('none');
    expect(agentFor(copilotHarness, {}, hostSandbox(noGit)).spendLimit!(['gpt-5'])).toBe('none');
    expect(agentFor(copilotHarness, {}, hostSandbox(noGit)).harnessId).toBe('copilot');
  });
  test('models only some of which are priced are reported as partial', () => {
    expect(agentFor(codexHarness, {a: price}, hostSandbox(noGit)).spendLimit!(['a', 'b'])).toBe('partial');
  });
});
