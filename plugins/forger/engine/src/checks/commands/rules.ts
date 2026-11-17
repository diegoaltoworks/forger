/** The rules of the commands gate: what a worker's harness needs in the repository, and what git says it has. */

import type {Finding} from '../waivers';

export const WORKER_COMMANDS_OPINION = 'base.worker-commands';

/** What git and the disk say about one command file. */
export type CommandFileState = 'tracked' | 'untracked' | 'ignored' | 'missing';

export interface CommandFileFact {
  path: string;
  state: CommandFileState;
}

const TODO: Record<Exclude<CommandFileState, 'tracked'>, {rule: string; detail: (path: string) => string}> = {
  missing: {rule: 'command-missing', detail: p => `${p} is missing; run \`work.ts setup\` to write it`},
  ignored: {rule: 'command-ignored', detail: p => `git ignores ${p}; take it out of the ignore rules, then \`git add ${p}\` and bring it to the base branch`},
  untracked: {rule: 'command-untracked', detail: p => `git does not track ${p}; \`git add ${p}\` and bring it to the base branch`}
};

/** A worker runs in a worktree made from the base branch, which holds tracked files only. */
export function commandsProblems(files: CommandFileFact[]): Finding[] {
  return files.flatMap(f => {
    if (f.state === 'tracked') return [];
    const todo = TODO[f.state];
    return [{file: f.path, line: 1, rule: todo.rule, opinion: WORKER_COMMANDS_OPINION, detail: todo.detail(f.path)}];
  });
}

/** What `setup` says after it writes command files: the ones a worker will not have until they are tracked on the base branch. */
export function formatUntrackedCommands(files: CommandFileFact[]): string[] {
  return files.flatMap(f => {
    if (f.state !== 'ignored' && f.state !== 'untracked') return [];
    const why = f.state === 'ignored' ? 'git ignores' : 'git does not track';
    return [`! ${why} ${f.path}; a worker will not have it until it is tracked and on the base branch (see \`work.ts check commands\`)`];
  });
}
