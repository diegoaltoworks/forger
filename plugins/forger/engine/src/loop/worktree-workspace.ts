/** The workspace half of a sandbox, as a git worktree: what the `host` sandbox does and the runner defaults to. */

import type {CapturingRunner, Sandbox} from '../ports';
import {finishWorktree} from './parallel';
import {createWorktree, worktreePath} from './worktree';

export type WorkspaceSandbox = Pick<Sandbox, 'prepare' | 'cleanup'>;

export function worktreeWorkspace(git: CapturingRunner): WorkspaceSandbox {
  return {
    prepare(request) {
      const made = createWorktree(git, request);
      if (!made.ok) return {ok: false, ticket: request.ticket, error: made.error ?? 'worktree failed'};
      return {ok: true, ticket: request.ticket, path: worktreePath(request.stateDir, request.ticket)};
    },
    cleanup(request, dropBranch) {
      return finishWorktree(git, request, dropBranch);
    },
  };
}
