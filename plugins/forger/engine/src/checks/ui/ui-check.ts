/**
 * The I/O half of `check ui`: reads the ui config, the branch's changes
 * against its merge-base and the UI files' contents. A missing config or unresolvable base is an error,
 * never a pass.
 */

import {readFileSync} from 'fs';
import {join} from 'path';

import {loadConfig} from '../../config';
import type {CommandRunner} from '../../ports';
import {mergeBase, parseNameStatus} from '../decisions';
import type {Finding} from '../waivers';
import {loadUiConfig} from './a11y-check';
import {runBaselineCheck} from './baseline-check';
import {checkTokens, tokenScanTargets} from './tokens';
import {checkUiEvidence} from './ui';

export function runUiCheck(projectRoot: string, run: CommandRunner): Finding[] {
  const config = loadUiConfig(projectRoot);
  const mb = mergeBase(run, loadConfig(projectRoot).base_branch);
  const changes = parseNameStatus(run(`git diff --name-status --no-renames ${mb}`));
  for (const p of run('git ls-files --others --exclude-standard').split('\n')) {
    if (p !== '' && !changes.some(c => c.path === p)) changes.push({path: p, status: 'added'});
  }
  const tracked = [...run('git ls-files').split('\n'), ...run('git ls-files --others --exclude-standard').split('\n')].filter(p => p !== '');
  const sources = tokenScanTargets([...new Set(tracked)], config).flatMap(path => {
    try {
      return [{path, content: readFileSync(join(projectRoot, path), 'utf-8')}];
    } catch {
      return [];
    }
  });
  return [...checkUiEvidence(changes, config), ...checkTokens(sources), ...runBaselineCheck(projectRoot, config)];
}
