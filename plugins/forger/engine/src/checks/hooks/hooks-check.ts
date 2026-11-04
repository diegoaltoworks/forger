/** Reads the hook policy and the harness's settings and hands them to the rules. */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {HOOKS_POLICY_PATH} from '../../hooks';
import type {Harness} from '../../ports';
import type {Finding} from '../waivers';
import {hookFindings} from './hooks';

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

/** A harness with no hooks forger can install has no settings to check. */
export function runHooksCheck(projectRoot: string, harness?: Harness): Finding[] {
  const hooks = harness?.hooks ?? null;
  const settings = hooks ? {path: hooks.path, installed: hooks.installed(read(join(projectRoot, hooks.path)))} : null;
  return hookFindings(read(join(projectRoot, HOOKS_POLICY_PATH)), settings);
}
