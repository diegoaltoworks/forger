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
import type {Gap} from '../gaps';
import type {Finding} from '../waivers';
import {loadUiConfig} from './a11y-check';
import {runBaselineCheck} from './baseline-check';
import {checkTokens, tokenScanTargets} from './tokens';
import {checkUiEvidence, narrowestViewportGaps} from './ui';

function prBody(run: CommandRunner): string {
  try {
    return run('gh pr view --json body --jq .body');
  } catch {
    return '';
  }
}

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
  return [...checkUiEvidence(changes, config, config.screenshots_branch === undefined ? '' : prBody(run)), ...checkTokens(sources), ...runBaselineCheck(projectRoot, config)];
}

/** `runUiCheck` with what it could not measure: the gaps are warnings, not failures. */
export function runUiCheckOutput(projectRoot: string, run: CommandRunner): {findings: Finding[]; gaps: Gap[]} {
  return {findings: runUiCheck(projectRoot, run), gaps: narrowestViewportGaps(loadUiConfig(projectRoot))};
}
