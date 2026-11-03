/**
 * The Backlog read from a backlog.json file: the fallback when the tracker
 * is not GitHub Issues (ADR 0001).
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
