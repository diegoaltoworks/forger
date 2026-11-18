/** The rules of the models gate: every model the config can pick is in the form the harness takes and, when a catalogue was read, in it. */

import type {WorkloopConfig} from '../../config';
import {resolveModel} from '../../config';
import type {Harness} from '../../ports';
import type {Finding} from '../waivers';

export const WORKER_MODELS_OPINION = 'base.worker-models';

const CONFIG_FILE = '.forger/workloop.config.json';

/** A model the config can pick, and the config key it came from. */
export interface PickableModel {
  key: string;
  role: string;
  id: string;
}

type Picks = Pick<WorkloopConfig, 'models' | 'model_by_priority' | 'verifier'>;

/** Each tier of `model_by_priority` and the verifier's, resolved through `models`. */
export function pickableModels(config: Picks): PickableModel[] {
  const tiers: Array<[string, string]> = [
    ...Object.entries(config.model_by_priority).map(([k, t]): [string, string] => [`model_by_priority.${k}.model`, t.model]),
    ...(config.verifier ? [['verifier.model', config.verifier.model] as [string, string]] : [])
  ];
  return tiers.map(([key, role]) => ({key, role, id: resolveModel(role, config.models)}));
}

/** The lines of a listing command's output, one id each. */
export function parseCatalogue(output: string): string[] {
  return output.split('\n').map(l => l.trim()).filter(l => l !== '');
}

/** A harness that says nothing about models, or no harness, has no problem; `catalogue` is null when none was read. */
export function modelsProblems(config: Picks, harness: Harness | undefined, catalogue: string[] | null): Finding[] {
  const says = harness?.models;
  if (!says) return [];
  return pickableModels(config).flatMap(m => {
    const mapping = `map the role under "models" in ${CONFIG_FILE}`;
    const problem = (rule: string, detail: string): Finding => ({file: CONFIG_FILE, line: 1, rule, opinion: WORKER_MODELS_OPINION, detail: `${m.key} resolves to "${m.id}", ${detail}`});
    if (!says.accepts(m.id)) {
      return [problem('model-form', `which is not ${says.form}, the form ${harness.id} takes; ${mapping} to an id in that form (\`${says.listing}\` lists them)`)];
    }
    if (catalogue !== null && !catalogue.includes(m.id)) {
      return [problem('model-unlisted', `which \`${says.listing}\` does not list; ${mapping} to one it lists`)];
    }
    return [];
  });
}
