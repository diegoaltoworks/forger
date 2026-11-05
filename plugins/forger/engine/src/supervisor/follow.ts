/**
 * Follow several loops' event files at once. Each repository is read by an
 * injected reader; a new event is handed to `emit` the moment a poll sees it,
 * tagged with its repository. Reading facts from files means there is no
 * process pattern for the watcher to match, and nothing between an event and
 * the line that reports it. A repository that cannot be read is reported once,
 * not skipped.
 */

import type {TerminalEvent} from '../loop';
import {tagEvent, type TaggedEvent} from './multi';

export interface FollowedRepo {
  name: string;
  read: () => TerminalEvent[];
  /** How long to wait between reads of this repository; a remote read is dearer than a local one. */
  pollMs: number;
}

export interface FollowOptions {
  repos: FollowedRepo[];
  emit: (line: string) => void;
  /** Events already in the files when the watch starts are not replayed. */
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  tickMs?: number;
  now?: () => string;
}

export function errorLine(repo: string, reason: string, at: string): string {
  return JSON.stringify({repo, event: 'watch_error', at, iteration: 0, ticket: null, reason});
}

export async function followEvents(o: FollowOptions): Promise<'timeout'> {
  const sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const tick = o.tickMs ?? 1000;
  const now = o.now ?? (() => new Date().toISOString());
  const seen = new Map<string, number>();
  const failing = new Map<string, string>();
  const due = new Map<string, number>();
  const poll = (r: FollowedRepo): void => {
    try {
      const events = r.read();
      failing.delete(r.name);
      const from = seen.get(r.name) ?? events.length;
      for (const e of events.slice(from)) o.emit(JSON.stringify(tagEvent(r.name, e) satisfies TaggedEvent));
      seen.set(r.name, events.length);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (failing.get(r.name) !== reason) o.emit(errorLine(r.name, reason, now()));
      failing.set(r.name, reason);
    }
  };
  for (const r of o.repos) poll(r);
  for (let elapsed = 0; elapsed <= o.timeoutMs; elapsed += tick) {
    await sleep(tick);
    for (const r of o.repos) {
      if (elapsed + tick >= (due.get(r.name) ?? 0)) {
        poll(r);
        due.set(r.name, elapsed + tick + r.pollMs);
      }
    }
  }
  return 'timeout';
}
