/**
 * `verify` and `merge` are new processes that load the engine from the folder
 * it sits in. When that folder is a git work tree with uncommitted changes, a
 * verdict or a merge would come from code nobody reviewed, so both refuse.
 */

import type {CommandRunner} from '../ports';

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The paths `git status --porcelain` lists, unquoted; a renamed file is listed by its new path. */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
}

/**
 * Uncommitted changes at or under the engine's root: a changed tracked file or a
 * new file git does not ignore. Empty when the root is not in a git work tree.
 */
export function engineChanges(run: CommandRunner, pluginRoot: string): string[] {
  try {
    if (run(`git -C ${quote(pluginRoot)} rev-parse --is-inside-work-tree`).trim() !== 'true') return [];
    return changedPaths(run(`git -C ${quote(pluginRoot)} status --porcelain --untracked-files=all -- .`));
  } catch {
    return [];
  }
}

/** The pause between two looks at the engine's checkout while a command waits for it to clear. */
export const ENGINE_LOOK_PAUSE_MS = 5000;

/**
 * Looks at the engine's changes, and while there are some looks again after each
 * pause, up to `waitSeconds`. Returns what the last look found: empty when the
 * changes went within the wait. The pause is passed in so no test waits in real time.
 */
export async function awaitCleanEngine(look: () => string[], sleep: (ms: number) => Promise<void>, waitSeconds: number, pauseMs: number = ENGINE_LOOK_PAUSE_MS): Promise<string[]> {
  let paths = look();
  let waited = 0;
  while (paths.length > 0 && waited < waitSeconds * 1000) {
    const step = Math.min(pauseMs, waitSeconds * 1000 - waited);
    await sleep(step);
    waited += step;
    paths = look();
  }
  return paths;
}

/** What a refused `verify` or `merge` says: the paths, whose cause it is, and that the caller stops without declining. */
export function engineChangedMessage(command: string, paths: string[]): string {
  return `${command}: refused. The engine this command runs from has uncommitted changes, and a verdict or a merge from a changed engine does not count: ${paths.join(', ')}. The cause is the engine's checkout, not the ticket. The checkout is not yours to repair: do not touch it and do not decline the ticket; stop and say so`;
}

/**
 * Why the loop halts for an iteration whose ticket has an `engine_changed` event
 * (its reason is `<command>: <paths>`); null when it has none. Read from the
 * recorded event, not from what the worker said.
 */
export function engineChangedHalt(events: {event: string; iteration: number; ticket: string | null; reason: string | null}[], iteration: number, ticket: string | null): string | null {
  const hit = events.filter(e => e.event === 'engine_changed' && e.iteration === iteration && e.ticket === ticket).pop();
  if (!hit) return null;
  return `${hit.reason ?? 'verify or merge'} was refused: the engine's checkout has uncommitted changes. Commit or discard the changes in the engine's checkout, then resume. "${ticket ?? 'the ticket'}" is not set aside and keeps its label and its open PR.`;
}
