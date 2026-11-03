/**
 * The StateStore over the state branch (ADR 0015). Reads fetch the branch into
 * a private ref and read blobs from it, and writes build a commit with plumbing
 * on a throwaway index, so neither moves HEAD nor touches the working tree.
 * A write is a non-forced push: when another writer got there first the push is
 * rejected, the branch is read again and the change is made again on top, up to
 * a bound. A lease that cannot be written within the bound is lost.
 */

import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {execCapture} from './exec';
import {decideLease, leaseFor} from '../loop';
import {eventDay, type LeaseClaim, type LeaseRequest, type StateBranch, type StateStore} from '../ports';

export interface GitStateOptions {
  /** The repository whose remote carries the state branch. */
  repo: string;
  remote?: string;
  branch?: string;
  /** Attempts per write before giving up; at least one. */
  attempts?: number;
}

const STATE = 'state.json';
const LEASE = 'lease.json';
const EVENTS = 'events/';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function gitStateStore(opts: GitStateOptions): StateStore & StateBranch {
  const remote = opts.remote ?? 'origin';
  const branch = opts.branch ?? 'forger-state';
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) throw new Error(`forger: unusable state branch name "${branch}"`);
  const run = execCapture(opts.repo);
  const attempts = Math.max(1, opts.attempts ?? 5);
  const ref = `refs/forger/${branch}`;

  /** Fetches the branch; the tip's commit id, or null when the branch is absent. */
  function fetchTip(): string | null {
    run(`git fetch --quiet ${q(remote)} +refs/heads/${branch}:${ref}`);
    const r = run(`git rev-parse --verify --quiet ${ref}`);
    return r.exitCode === 0 && r.stdout !== '' ? r.stdout : null;
  }

  function blob(tip: string | null, path: string): string | null {
    if (tip === null) return null;
    const r = run(`git show ${tip}:${q(path)}`);
    return r.exitCode === 0 ? r.stdout : null;
  }

  function eventFiles(tip: string | null): string[] {
    if (tip === null) return [];
    const r = run(`git ls-tree --name-only ${tip} ${EVENTS}`);
    return r.exitCode === 0 ? r.stdout.split('\n').filter(Boolean).sort() : [];
  }

  /** Commits `files` on top of `tip` and pushes without force; false when refused. */
  function push(tip: string | null, files: Record<string, string>, message: string): boolean {
    const dir = mkdtempSync(join(tmpdir(), 'forger-state-'));
    try {
      const git = execCapture(opts.repo, {GIT_INDEX_FILE: join(dir, 'index')});
      if (tip !== null) git(`git read-tree ${tip}`);
      for (const [path, text] of Object.entries(files)) {
        const file = join(dir, 'blob');
        writeFileSync(file, text);
        const hashed = run(`git hash-object -w ${q(file)}`);
        if (hashed.exitCode !== 0) return false;
        if (git(`git update-index --add --cacheinfo 100644,${hashed.stdout},${q(path)}`).exitCode !== 0) return false;
      }
      const tree = git('git write-tree');
      if (tree.exitCode !== 0) return false;
      const parent = tip === null ? '' : `-p ${tip}`;
      const commit = run(
        `git -c user.name=forger -c user.email=forger@localhost commit-tree ${tree.stdout} ${parent} -m ${q(message)}`
      );
      if (commit.exitCode !== 0) return false;
      return run(`git push --quiet ${q(remote)} ${commit.stdout}:refs/heads/${branch}`).exitCode === 0;
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }

  /** Re-reads and re-applies `change` until a push is accepted or the attempts run out. */
  function update(message: string, change: (read: (path: string) => string | null) => Record<string, string> | null): boolean {
    for (let i = 0; i < attempts; i++) {
      const tip = fetchTip();
      const files = change(path => blob(tip, path));
      if (files === null) return true;
      if (push(tip, files, message)) return true;
    }
    return false;
  }

  function parse(text: string | null): unknown {
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    exists: () => fetchTip() !== null,
    readLease: () => parse(blob(fetchTip(), LEASE)),
    seed: (files, message) => (fetchTip() === null ? push(null, files, message) : false),
    readState: () => blob(fetchTip(), STATE),
    writeState(text) {
      if (!update('state', () => ({[STATE]: text}))) throw new Error('forger: could not write the state branch');
    },
    appendEvent(line, at) {
      const path = `${EVENTS}${eventDay(at)}.jsonl`;
      // A read trims the blob's last newline, so the separator is put back here.
      const ok = update('event', read => {
        const kept = read(path);
        return {[path]: `${kept === null || kept === '' ? '' : `${kept}\n`}${line.replace(/\n$/, '')}\n`};
      });
      if (!ok) throw new Error('forger: could not write the state branch');
    },
    readEvents() {
      const tip = fetchTip();
      return eventFiles(tip)
        .map(f => blob(tip, f) ?? '')
        .map(t => (t === '' || t.endsWith('\n') ? t : `${t}\n`))
        .join('');
    },
    claimLease(req: LeaseRequest): LeaseClaim {
      let result: LeaseClaim = {ok: false, reason: 'lost'};
      const ok = update('lease', read => {
        const existing = parse(read(LEASE));
        const decision = decideLease(existing, req.self, req.now);
        if (decision.action === 'refuse') {
          result = {ok: false, reason: 'held', holder: decision.holder, expiresAt: decision.expiresAt};
          return null;
        }
        const lease = leaseFor(decision, existing, req);
        result = decision.action === 'takeover' ? {ok: true, ...decision, lease} : {ok: true, action: decision.action, lease};
        return {[LEASE]: JSON.stringify(lease, null, 2)};
      });
      return ok ? result : {ok: false, reason: 'lost'};
    },
    releaseLease(self) {
      update('lease released', read => {
        const held = parse(read(LEASE)) as {holder?: string} | null;
        return held?.holder === self ? {[LEASE]: ''} : null;
      });
    },
  };
}
