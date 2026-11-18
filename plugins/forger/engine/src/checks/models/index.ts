import type {WorkloopConfig} from '../../config';
import type {Harness} from '../../ports';
import type {Finding} from '../waivers';
import {modelsProblems} from './rules';

export * from './rules';
export * from './catalogue';

/** The form problems alone: `check` and `setup` read no catalogue. */
export function runModelsCheck(config: WorkloopConfig, harness: Harness | undefined): Finding[] {
  return modelsProblems(config, harness, null);
}

/** The sentence `run` gives for a red models gate; null when it is green. */
export function modelsGateRefusal(findings: Finding[]): string | null {
  if (findings.length === 0) return null;
  return `the models gate fails (${findings.map(f => f.detail).join('; ')}); see \`work.ts check models\``;
}
