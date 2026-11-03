import {dirname, join} from 'path';

import {execCapture} from '../adapters';
import {capturing} from '../ports';
import {createWorktree, rebaseOnBase, removeWorktree} from '../loop';
import type {Command} from './command';

function options(ticket: string | undefined, ctx: Parameters<Command['run']>[0]) {
  return {
    ticket: ticket ?? '',
    baseBranch: ctx.config.base_branch,
    stateDir: dirname(join(ctx.projectRoot, ctx.config.paths.state)),
  };
}

function runner(ctx: Parameters<Command['run']>[0]) {
  return ctx.deps.run ? capturing(ctx.deps.run) : execCapture(ctx.projectRoot);
}

export const worktree: Command = {
  name: 'worktree',
  needs: 'config',
  flags: ['json', 'ticket', 'remove'],
  help: `  worktree --ticket ID [--remove] [--json]
                   Create the ticket's own worktree and feat/ID branch from the remote base
                   branch and print its path (--remove: remove the worktree, keep the branch);
                   the main checkout is never moved (exit 1 on failure)`,
  run(ctx) {
    const {values} = ctx;
    const o = options(values.ticket as string | undefined, ctx);
    const r = values.remove ? removeWorktree(runner(ctx), o) : createWorktree(runner(ctx), o);
    if (!r.ok) process.exitCode = 1;
    console.log(values.json ? JSON.stringify(r) : r.ok ? r.path : `worktree: ${r.error}`);
  },
};

export const rebase: Command = {
  name: 'rebase',
  needs: 'config',
  flags: ['json', 'ticket'],
  help: `  rebase --ticket ID [--json]
                   Rebase the ticket's branch on the current remote base branch, in its worktree,
                   and report clean, conflict (with the files; the rebase is left in progress there
                   to resolve) or error (exit 1 unless clean)`,
  run(ctx) {
    const r = rebaseOnBase(runner(ctx), options(ctx.values.ticket as string | undefined, ctx));
    if (r.status !== 'clean') process.exitCode = 1;
    const text =
      r.status === 'clean'
        ? `${r.branch} is on ${r.onto}`
        : r.status === 'conflict'
          ? `${r.branch} conflicts with ${r.onto}: ${r.files.join(', ')}`
          : `rebase: ${r.error}`;
    console.log(ctx.values.json ? JSON.stringify(r) : text);
  },
};
