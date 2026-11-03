/**
 * The files a check scans: tracked, plus untracked files git does not ignore.
 * A new file is untracked until it is committed, and the local gates run
 * before the commit; a check that read only tracked files passed a new file
 * locally and failed it in CI.
 */

import type {CommandRunner} from '../ports';

export function projectFiles(run: CommandRunner): string[] {
  const listed = [...run('git ls-files').split('\n'), ...run('git ls-files --others --exclude-standard').split('\n')];
  return [...new Set(listed.filter(p => p !== ''))];
}
