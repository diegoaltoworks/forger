/**
 * One git worktree per worker (ADR 0011): the worker builds in its own tree and
 * branch, sharing the object store, so the main checkout is never moved. Every
 * git call goes through the injected runner, and every call that changes a
 * tree names the worktree with `git -C`; the main checkout only gains or loses
 * a worktree entry.
 */

import {join} from 'path';

import type {CapturingRunner, CommandRunner} from '../ports';

export interface WorktreeResult {
  ok: boolean;
  ticket: string;
  branch: string;
  path: string;
  /** Why it failed; null when ok. */
  error: string | null;
  /** True when the ticket's own worktree was already there and is used as it is. */
  reused?: boolean;
  /** True when the ticket's branch had no commit of its own and was started again from the base. */
  restarted?: boolean;
}

/** What git lists at a path: nothing, the ticket's own worktree, or another checkout. */
export type PathHolder = {kind: 'none'} | {kind: 'ticket'} | {kind: 'other'; checkedOut: string};

/** Read `git worktree list --porcelain` for what is at `path` when `branch` is the ticket's. Pure. */
export function worktreeAt(porcelain: string, path: string, branch: string): PathHolder {
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim());
    if (!lines.includes(`worktree ${path}`)) continue;
    const ref = lines.find(l => l.startsWith('branch '))?.slice('branch '.length);
    if (ref === `refs/heads/${branch}`) return {kind: 'ticket'};
    return {kind: 'other', checkedOut: ref ? ref.replace(/^refs\/heads\//, '') : 'a detached head'};
  }
  return {kind: 'none'};
}

export type RebaseResult =
  | {status: 'clean'; ticket: string; branch: string; path: string; onto: string; next: string | null}
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

export function quote(s: string): string {
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
  // A dead runner leaves its worktree, maybe with uncommitted work: use it, touch nothing in it.
  const listed = run('git worktree list --porcelain');
  if (listed.exitCode === 0) {
    const holder = worktreeAt(listed.stdout, path, branch);
    if (holder.kind === 'ticket') return {...base, ok: true, error: null, reused: true};
    if (holder.kind === 'other') return {...base, ok: false, error: `${path} is a worktree with ${holder.checkedOut} checked out, not ${branch}`};
  }
  // An earlier attempt at the ticket leaves its branch behind (removeWorktree
  // keeps it), so a retry checks that branch out rather than failing on -b.
  const exists = run(`git rev-parse --verify --quiet ${quote(`refs/heads/${branch}`)}`).exitCode === 0;
  // A branch with nothing of its own holds no work to lose, and would carry the base as it was then.
  const origin = quote(`origin/${o.baseBranch}`);
  const counted = exists ? run(`git rev-list --count ${origin}..${quote(branch)}`) : null;
  const restart = counted !== null && counted.exitCode === 0 && counted.stdout.trim() === '0';
  const added = !exists
    ? run(`git worktree add -b ${quote(branch)} ${quote(path)} ${origin}`)
    : restart
      ? run(`git worktree add -B ${quote(branch)} ${quote(path)} ${origin}`)
      : run(`git worktree add ${quote(path)} ${quote(branch)}`);
  if (added.exitCode !== 0) return {...base, ok: false, error: failure(added)};
  return {...base, ok: true, error: null, ...(restart ? {restarted: true} : {})};
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
  const before = run(`${git} rev-parse HEAD`).stdout.trim();
  const rebased = run(`${git} rebase ${quote(onto)}`);
  if (rebased.exitCode === 0) {
    // A rewritten branch no longer fast-forwards its remote; the hook refuses -f, so name the push that works.
    const rewritten = run(`${git} rev-parse HEAD`).stdout.trim() !== before;
    return {...base, status: 'clean', next: rewritten ? `git push --force-with-lease origin ${branch}` : null};
  }
  const unmerged = run(`${git} diff --name-only --diff-filter=U`);
  const files = unmerged.exitCode === 0 ? unmerged.stdout.split('\n').map(f => f.trim()).filter(Boolean) : [];
  if (files.length === 0) return {...base, status: 'error', error: failure(rebased)};
  return {...base, status: 'conflict', files};
}

/**
 * A git runner whose `git` calls act on a worktree instead of the main
 * checkout. Other commands (the PR lookups) run as given. Pure.
 */
export function inWorktree(run: CommandRunner, path: string): CommandRunner {
  return cmd => run(cmd.startsWith('git ') ? `git -C ${quote(path)} ${cmd.slice(4)}` : cmd);
}
