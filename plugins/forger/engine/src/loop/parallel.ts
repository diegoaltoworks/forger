/**
 * The pieces of the parallel loop that decide or compose, apart from the
 * scheduler that drives them (ADR 0011): where a worker's git calls run, the
 * folder map the scheduling rule reads, whether a finished branch still
 * conflicts with base, and what is cleaned up after a worker.
 */

import {rootsFromModulePaths, type FolderMap} from '../backlog';
import type {CapturingRunner, CommandRunner} from '../ports';
import {rebaseOnBase, removeWorktree, ticketBranch, type WorktreeOptions} from './worktree';

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * A git runner whose `git` calls act on a worktree instead of the main
 * checkout. Other commands (the PR lookups) run as given. Pure.
 */
export function inWorktree(run: CommandRunner, path: string): CommandRunner {
  return cmd => run(cmd.startsWith('git ') ? `git -C ${quote(path)} ${cmd.slice(4)}` : cmd);
}

/**
 * The state directory a worktree command derives its paths from. Inside a
 * worker's own worktree the project root is that worktree, so its state
 * directory is the one the worktree lives under, not a new one nested in it. Pure.
 */
export function stateDirFor(projectRoot: string, statePath: string, ticket: string): string {
  const parts = projectRoot.split('/');
  const n = parts.length;
  if (n >= 3 && parts[n - 1] === ticket && parts[n - 2] === 'worktrees') return parts.slice(0, n - 2).join('/');
  const dir = statePath.split('/').slice(0, -1).join('/');
  return dir === '' ? projectRoot : `${projectRoot}/${dir}`;
}

/** The folder map from the architecture map's `modules.paths` and a directory lister. Pure given the lister. */
export function folderMapFrom(
  architecture: {modules?: {paths?: string[]}} | null,
  listDirs: (root: string) => string[]
): FolderMap {
  const roots = rootsFromModulePaths(architecture?.modules?.paths ?? []);
  return {roots, folders: roots.flatMap(root => listDirs(root).map(d => `${root}/${d}`))};
}

/**
 * Whether the branch still conflicts with base after the worker's one
 * attempt: the files in conflict, or null when it rebases clean (or the check
 * itself could not run, which is not a conflict). A conflicting rebase is
 * aborted, so the tree is left as it was.
 */
export function conflictAfterAttempt(run: CapturingRunner, o: WorktreeOptions): string[] | null {
  const r = rebaseOnBase(run, o);
  if (r.status !== 'conflict') return null;
  run(`git -C ${quote(r.path)} rebase --abort`);
  return r.files;
}

/**
 * Takes down a worker's worktree. A branch that conflicted is dropped with it,
 * locally and on the remote, so the ticket can be rebuilt serially from base;
 * any other branch stays, being the PR's head or already merged.
 */
export function finishWorktree(run: CapturingRunner, o: WorktreeOptions, dropBranch: boolean): string | null {
  const removed = removeWorktree(run, o);
  if (!removed.ok) return removed.error;
  if (!dropBranch) return null;
  const branch = ticketBranch(o.ticket);
  run(`git branch -D ${quote(branch)}`);
  run(`git push origin --delete ${quote(branch)}`);
  return null;
}
