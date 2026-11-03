/**
 * Which Backlog the engine reads, from the tracker kind: GitHub Issues for
 * `github`, the backlog.json file for `local` and `none` (ADR 0001).
 */

import {join} from 'path';

import type {Backlog} from '../backlog';
import type {WorkloopConfig} from '../config';
import {fileBacklog} from '../backlog';
import {execCapture} from '../adapters';
import {type CommandRunner, capturing} from '../ports';
import {githubBacklog} from '../backlog';

export type BacklogSource = 'github' | 'file';

export function backlogSource(config: WorkloopConfig): BacklogSource {
  return config.tracker.kind === 'github' ? 'github' : 'file';
}

export function openBacklog(
  projectRoot: string,
  config: WorkloopConfig,
  run?: CommandRunner
): Backlog {
  return backlogSource(config) === 'github'
    ? githubBacklog(run ? capturing(run) : execCapture(projectRoot), config)
    : fileBacklog(join(projectRoot, config.paths.backlog), config);
}
