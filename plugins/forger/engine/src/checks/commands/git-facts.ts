/** Asks git about each command file the harness needs and hands the answers to the rules. */

import {existsSync} from 'fs';
import {join} from 'path';

import type {CommandRunner} from '../../ports';
import type {Finding} from '../waivers';
import {commandsProblems, type CommandFileFact} from './rules';

function lines(run: CommandRunner, command: string): Set<string> {
  try {
    return new Set(run(command).split('\n').map(l => l.trim()).filter(l => l !== ''));
  } catch {
    return new Set();
  }
}

const quoted = (paths: string[]) => paths.map(p => `'${p}'`).join(' ');

/** What git says about each command file the harness needs; no paths, as for a harness that loads the plugin for the session, means no call to git. */
export function commandFileFacts(projectRoot: string, paths: string[], run: CommandRunner): CommandFileFact[] {
  if (paths.length === 0) return [];
  const present = paths.filter(p => existsSync(join(projectRoot, p)));
  const tracked = lines(run, `git ls-files -- ${quoted(present)}`);
  const ignored = present.length === 0 ? new Set<string>() : lines(run, `git check-ignore -- ${quoted(present)}`);
  return paths.map(path => ({path, state: !present.includes(path) ? 'missing' : tracked.has(path) ? 'tracked' : ignored.has(path) ? 'ignored' : 'untracked'}));
}

export function runCommandsCheck(projectRoot: string, paths: string[], run: CommandRunner): Finding[] {
  return commandsProblems(commandFileFacts(projectRoot, paths, run));
}
