/**
 * The I/O half of `check ui`: reads the ui config and the branch's changes
 * against its merge-base. A missing config or unresolvable base is an error,
 * never a pass.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {loadConfig} from '../../config';
import type {CommandRunner} from '../../ports';
import {UI_PATH, parseUiConfig} from '../../ui';
import {mergeBase, parseNameStatus} from '../decisions';
import type {Finding} from '../waivers';
import {checkUiEvidence} from './ui';

export function runUiCheck(projectRoot: string, run: CommandRunner): Finding[] {
  const path = join(projectRoot, UI_PATH);
  if (!existsSync(path)) throw new Error(`${UI_PATH} not found; the ui pack's config is required`);
  const config = parseUiConfig(readFileSync(path, 'utf-8'));
  const mb = mergeBase(run, loadConfig(projectRoot).base_branch);
  const changes = parseNameStatus(run(`git diff --name-status --no-renames ${mb}`));
  for (const p of run('git ls-files --others --exclude-standard').split('\n')) {
    if (p !== '' && !changes.some(c => c.path === p)) changes.push({path: p, status: 'added'});
  }
  return checkUiEvidence(changes, config);
}
