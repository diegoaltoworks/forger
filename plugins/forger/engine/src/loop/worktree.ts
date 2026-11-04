/**
 * One git worktree per worker (ADR 0011): the worker builds in its own tree and
 * branch, sharing the object store, so the main checkout is never moved. Every
 * git call goes through the injected runner, and every call that changes a
 * tree names the worktree with `git -C`; the main checkout only gains or loses
 * a worktree entry.
 */

import {join} from 'path';

import type {CapturingRunner} from '../ports';

export interface WorktreeResult {
  ok: boolean;
  ticket: string;
  branch: string;
  path: string;
  /** Why it failed; null when ok. */
  error: string | null;
}

export type RebaseResult =
  | {status: 'clean'; ticket: string; branch: string; path: string; onto: string}
  | {status: 'conflict'; ticket: string; branch: string; path: string; onto: string; files: string[]}
  | {status: 'error'; ticket: string; branch: string; path: string; onto: string; error: string};

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The branch a ticket is built on: the same name the worker's prompt gives. Pure. */
export function ticketBranch(ticket: string): string {
  return `feat/${ticket}`;
}

/** Where a ticket's worktree lives, beside the engine's state. Pure. */
export function worktreePath(stateDir: string, ticket: string): string {
  return join(stateDir, 'worktrees', ticket);
}

/** A ticket id becomes a path and a branch, so it must not carry separators or shell syntax. Pure. */
export function validTicket(ticket: string): boolean {
  return SAFE.test(ticket) && !ticket.includes('..');
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The line that says why. Git writes progress ("Preparing worktree ...") to
 * stderr before its `fatal:`, so the first line is often not the reason.
 */
function failure(r: {stderr: string; stdout: string}): string {
  const lines = (r.stderr || r.stdout || 'command failed').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.find(l => /^(fatal|error):/i.test(l)) ?? lines[0] ?? 'command failed';
}

export interface WorktreeOptions {
  ticket: string;
  baseBranch: string;
  stateDir: string;
}

/** Create the ticket's worktree and branch from the base branch as the remote has it. */
export function createWorktree(run: CapturingRunner, o: WorktreeOptions): WorktreeResult {
  const branch = ticketBranch(o.ticket);
  const path = worktreePath(o.stateDir, o.ticket);
  const base = {ticket: o.ticket, branch, path};
  if (!validTicket(o.ticket)) return {...base, ok: false, error: `not a usable ticket id: ${o.ticket}`};
  const fetched = run(`git fetch origin ${quote(o.baseBranch)}`);
  if (fetched.exitCode !== 0) return {...base, ok: false, error: `fetch failed: ${failure(fetched)}`};
  // An earlier attempt at the ticket leaves its branch behind (removeWorktree
  // keeps it), so a retry checks that branch out rather than failing on -b.
  const exists = run(`git rev-parse --verify --quiet ${quote(`refs/heads/${branch}`)}`).exitCode === 0;
  const added = exists
    ? run(`git worktree add ${quote(path)} ${quote(branch)}`)
    : run(`git worktree add -b ${quote(branch)} ${quote(path)} ${quote(`origin/${o.baseBranch}`)}`);
  if (added.exitCode !== 0) return {...base, ok: false, error: failure(added)};
  return {...base, ok: true, error: null};
}

/** Remove the ticket's worktree. The branch stays: it is the PR's head or already merged. */
export function removeWorktree(run: CapturingRunner, o: Pick<WorktreeOptions, 'ticket' | 'stateDir'>): WorktreeResult {
  const branch = ticketBranch(o.ticket);
  const path = worktreePath(o.stateDir, o.ticket);
  const base = {ticket: o.ticket, branch, path};
  if (!validTicket(o.ticket)) return {...base, ok: false, error: `not a usable ticket id: ${o.ticket}`};
  const removed = run(`git worktree remove --force ${quote(path)}`);
  if (removed.exitCode !== 0) return {...base, ok: false, error: failure(removed)};
  return {...base, ok: true, error: null};
}

/**
 * Rebase the ticket's branch on the current base, in its worktree. A conflict
 * leaves the rebase in progress there, for the worker to resolve and continue;
 * the files that conflict are listed.
 */
export function rebaseOnBase(run: CapturingRunner, o: WorktreeOptions): RebaseResult {
  const branch = ticketBranch(o.ticket);
  const path = worktreePath(o.stateDir, o.ticket);
  const onto = `origin/${o.baseBranch}`;
  const base = {ticket: o.ticket, branch, path, onto};
  if (!validTicket(o.ticket)) return {...base, status: 'error', error: `not a usable ticket id: ${o.ticket}`};
  const git = `git -C ${quote(path)}`;
  const fetched = run(`${git} fetch origin ${quote(o.baseBranch)}`);
  if (fetched.exitCode !== 0) return {...base, status: 'error', error: `fetch failed: ${failure(fetched)}`};
  const rebased = run(`${git} rebase ${quote(onto)}`);
  if (rebased.exitCode === 0) return {...base, status: 'clean'};
  const unmerged = run(`${git} diff --name-only --diff-filter=U`);
  const files = unmerged.exitCode === 0 ? unmerged.stdout.split('\n').map(f => f.trim()).filter(Boolean) : [];
  if (files.length === 0) return {...base, status: 'error', error: failure(rebased)};
  return {...base, status: 'conflict', files};
}
