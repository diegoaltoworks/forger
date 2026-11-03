/**
 * The Backlog read from a backlog.json file: the local fallback, and the
 * backlog for trackers that do not hold the tickets themselves.
 */

import {readFileSync} from 'fs';

import {type Backlog, type BacklogData, backlogFrom} from './backlog';
import type {WorkloopConfig} from './config';

export function readBacklogFile(file: string): BacklogData | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as BacklogData;
  } catch {
    return null;
  }
}

export function fileBacklog(file: string, config: WorkloopConfig): Backlog {
  return backlogFrom(() => readBacklogFile(file), config);
}
