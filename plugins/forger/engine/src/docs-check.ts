/**
 * `check docs`: runs the writing rules over every tracked text file. The list
 * comes from git so untracked and ignored files (the denylist itself, build
 * output) are never scanned.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {CommandRunner} from './git';
import {checkText, parseDenylist, type Violation} from './docs-rules';

/** Lockfiles are generated, not written. */
const SKIP = [/(^|\/)bun\.lock$/];

export function runDocsCheck(projectRoot: string, run: CommandRunner): Violation[] {
  const denyFile = join(projectRoot, '.forger-denylist');
  const terms = existsSync(denyFile) ? parseDenylist(readFileSync(denyFile, 'utf-8')) : [];
  const files = run('git ls-files').split('\n').filter(f => f !== '' && !SKIP.some(s => s.test(f)));

  const out: Violation[] = [];
  for (const file of files) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    if (buf.includes(0)) continue;
    out.push(...checkText(file, buf.toString('utf-8'), terms));
  }
  return out;
}
