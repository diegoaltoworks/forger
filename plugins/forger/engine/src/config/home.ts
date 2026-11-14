/**
 * Where each forger file lives (ADR 0015): the main branch with the code, the
 * state branch, the tracker, or the machine that ran. This table is the source
 * of truth for the split; a path it does not name is an error, so a new file
 * cannot slip into a default home.
 */

import {FORGER_DIR} from './layout';

export type Home = 'main' | 'state' | 'tracker' | 'local';

/** Top-level entries (files or folders) under `.forger/` and their home. */
export const HOMES: Readonly<Record<string, Home>> = {
  'workloop.config.json': 'main',
  'process.md': 'main',
  opinions: 'main',
  templates: 'main',
  rules: 'main',
  'architecture.json': 'main',
  'testing.json': 'main',
  'safety.json': 'main',
  'ui.json': 'main',
  'journeys.json': 'main',
  'deliver.json': 'main',
  'waivers.json': 'main',
  'coverage-baseline.json': 'main',
  'budgets.json': 'main',
  'budgets-baseline.json': 'main',
  'forger.lock.json': 'main',
  'human.md': 'main',
  inbox: 'main',
  'backlog.json': 'main',
  'backlog.md': 'main',
  'declined.json': 'main',
  'state.json': 'state',
  'events.jsonl': 'state',
  events: 'state',
  'lease.json': 'state',
  HALT: 'tracker',
  output: 'local',
  'work.log': 'local',
  'runner.lock': 'local',
  'checks.jsonl': 'local',
};

/**
 * Pure: the home of a logical path, given with or without the `.forger/`
 * prefix. Throws for a path the table does not name.
 */
export function homeOf(path: string): Home {
  const rest = path.startsWith(`${FORGER_DIR}/`) ? path.slice(FORGER_DIR.length + 1) : path;
  const top = rest.split('/')[0];
  const home = Object.hasOwn(HOMES, top) ? HOMES[top] : top.endsWith('.upstream') ? 'main' : undefined;
  if (!home) throw new Error(`forger: no home for "${path}"; add it to HOMES in config/home.ts`);
  return home;
}
