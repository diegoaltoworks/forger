/**
 * `migrate --state` (ADR 0015): moves the loop's state record and event log to
 * the state branch and sets `state.home`. The split of the event log by day is
 * pure; the branch is reached through the StateBranch port. Local files are
 * left where they are, so rolling back is setting `state.home` back.
 */

import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {loadConfig} from '../config';
import {decideLease, RunnerLock} from '../loop';
import type {StateBranch} from '../ports';
import {eventDay} from '../ports';
import {MigrateRefused} from './migrate';

const DEFAULT_BRANCH = 'forger-state';

/**
 * Pure: the event log as one text per day file, every line kept and in order.
 * A line takes the day of its `at`; one without a readable `at` (or one that
 * would step back in time) stays with the line before it, so concatenating the
 * files in name order gives the log back exactly.
 */
export function splitEventsByDay(text: string, fallbackDay: string): Record<string, string> {
  const files: Record<string, string> = {};
  let day = '';
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let own = '';
    try {
      const at = Date.parse((JSON.parse(line) as {at?: unknown}).at as string);
      if (!Number.isNaN(at)) own = eventDay(new Date(at));
    } catch {
      // not JSON: it keeps the previous line's day
    }
    if (own > day) day = own;
    if (day === '') day = own || fallbackDay;
    const path = `events/${day}.jsonl`;
    files[path] = `${files[path] ?? ''}${line}\n`;
  }
  return files;
}

export interface MigrateStateResult {
  status: 'migrated' | 'nothing';
  branch: string;
  /** The files committed to the branch, empty when it already existed. */
  seeded: string[];
}

export interface MigrateStateOptions {
  projectRoot: string;
  branch: StateBranch;
  branchName?: string;
  now?: Date;
}

interface StateConfigFile {
  state?: {home?: string; branch?: string};
  [key: string]: unknown;
}

function readLocal(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

export function runMigrateState(opts: MigrateStateOptions): MigrateStateResult {
  const {projectRoot, branch} = opts;
  const now = opts.now ?? new Date();
  const config = loadConfig(projectRoot);
  const holder = new RunnerLock(join(projectRoot, config.paths.lock)).liveHolder();
  if (holder !== null) throw new MigrateRefused(`An engine (pid ${holder}) holds the lock; stop it before migrating`);

  const localLease = readLocal(join(projectRoot, config.paths.state, '..', 'lease.json'));
  const leases: unknown[] = [];
  try {
    if (localLease !== null) leases.push(JSON.parse(localLease));
  } catch {
    // an unreadable lease holds nobody
  }
  if (branch.exists()) leases.push(branch.readLease());
  for (const lease of leases) {
    const verdict = decideLease(lease, 'migrate', now);
    if (verdict.action === 'refuse') {
      throw new MigrateRefused(`${verdict.holder} holds a live lease until ${verdict.expiresAt}; wait for it or stop that engine before migrating`);
    }
  }

  const name = opts.branchName ?? DEFAULT_BRANCH;
  let seeded: string[] = [];
  if (!branch.exists()) {
    const files: Record<string, string> = {};
    const state = readLocal(join(projectRoot, config.paths.state));
    if (state !== null) files['state.json'] = state;
    Object.assign(files, splitEventsByDay(readLocal(join(projectRoot, config.paths.events)) ?? '', eventDay(now)));
    if (Object.keys(files).length === 0) files['state.json'] = '{}\n';
    if (!branch.seed(files, 'migrate state to the state branch')) {
      throw new MigrateRefused(`Could not push the state branch "${name}" to the remote`);
    }
    seeded = Object.keys(files).sort();
  }

  const home = setStateHome(projectRoot, name);
  return {status: seeded.length > 0 || home ? 'migrated' : 'nothing', branch: name, seeded};
}

/** Sets `state.home` to `branch` in the project's config file; true when that changed it. */
function setStateHome(projectRoot: string, name: string): boolean {
  const dir = existsSync(join(projectRoot, '.forger')) ? '.forger' : '.claude';
  const file = join(projectRoot, dir, 'workloop.config.json');
  const config: StateConfigFile = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as StateConfigFile) : {};
  if (config.state?.home === 'branch' && config.state.branch === name) return false;
  config.state = {...config.state, home: 'branch', branch: name};
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

export function formatMigrateState(r: MigrateStateResult): string {
  if (r.status === 'nothing') return 'state already on the state branch';
  const lines = r.seeded.length > 0 ? r.seeded.map(f => `committed ${r.branch}:${f}`) : [`kept ${r.branch} (it already exists)`];
  lines.push('set state.home to branch');
  return lines.join('\n');
}
