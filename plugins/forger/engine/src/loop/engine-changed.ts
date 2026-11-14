/**
 * `verify` and `merge` are new processes that load the engine from the folder
 * it sits in. When that folder is a git work tree with uncommitted changes, a
 * verdict or a merge would come from code nobody reviewed, so both refuse.
 */

import type {CommandRunner} from '../ports';

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The paths `git status --porcelain` lists, unquoted; a renamed file is listed by its new path. */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
}

/**
 * Uncommitted changes at or under the engine's root: a changed tracked file or a
 * new file git does not ignore. Empty when the root is not in a git work tree.
 */
export function engineChanges(run: CommandRunner, pluginRoot: string): string[] {
  try {
    if (run(`git -C ${quote(pluginRoot)} rev-parse --is-inside-work-tree`).trim() !== 'true') return [];
    return changedPaths(run(`git -C ${quote(pluginRoot)} status --porcelain --untracked-files=all -- .`));
  } catch {
    return [];
  }
}

/** What a refused `verify` or `merge` says: the paths, and that nothing decided by this engine counts. */
export function engineChangedMessage(command: string, paths: string[]): string {
  return `${command}: refused. The engine this command runs from has uncommitted changes, and a verdict or a merge from a changed engine does not count: ${paths.join(', ')}. The engine's checkout is not yours to repair; decline the ticket and say so`;
}
