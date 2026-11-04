/**
 * `check hooks`: the boundaries a worker is only asked to respect are enforced
 * by the harness hook. A project fails when its policy is missing or broken,
 * when it drops one of the default rules (a waiver on `base.worker-hooks`
 * records who approved that), or when the harness's settings do not run the
 * hook. Pure over the texts handed in.
 */

import {droppedRules, HOOKS_POLICY_PATH, parseHookPolicy} from '../../hooks';
import type {Finding} from '../waivers';

export const WORKER_HOOKS_OPINION = 'base.worker-hooks';

export interface HookSettings {
  path: string;
  installed: boolean;
}

export function hookFindings(policyText: string | null, settings: HookSettings | null): Finding[] {
  const finding = (file: string, rule: string, detail: string): Finding => ({file, line: 1, rule, opinion: WORKER_HOOKS_OPINION, detail});
  const out: Finding[] = [];
  if (policyText === null) {
    out.push(finding(HOOKS_POLICY_PATH, 'policy-missing', 'no hook policy; run setup to install the default'));
  } else {
    try {
      for (const rule of droppedRules(parseHookPolicy(policyText))) out.push(finding(HOOKS_POLICY_PATH, 'default-dropped', `drops the default rule ${rule}`));
    } catch (e) {
      out.push(finding(HOOKS_POLICY_PATH, 'policy-invalid', (e as Error).message));
    }
  }
  if (settings && !settings.installed) out.push(finding(settings.path, 'hook-missing', "the harness's settings do not run `work.ts hook`; run setup"));
  return out;
}
