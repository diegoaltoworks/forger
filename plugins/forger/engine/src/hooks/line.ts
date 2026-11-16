/**
 * The line a harness runs for the hook. A harness lets a call through on every
 * outcome of a hook command but a refusal (exit 2), so a hook that cannot run
 * (a wrong path, no `bun`, a kill) would leave the guard installed and inert.
 * The line decides on the exit status: a worker's call is refused, any other
 * session is told it is not guarded. Pure.
 */

/** The text every fail-closed line and plugin carries; the check looks for it. */
export const HOOK_LINE_MARK = 'forger hook could not run';

/** The hook call earlier installs wrote as the whole command; setup replaces it. */
export const EARLIER_HOOK_LINE = 'bun "$FORGER_PLUGIN_ROOT/bin/work.ts" hook';

/** Wraps the hook call: 0 and 2 pass through, any other status refuses for a worker and warns for anyone else. */
export function hookCommandLine(call: string): string {
  const status = 'forger_status';
  return [
    `${call}; ${status}=$?`,
    `case $${status} in 0|2) exit $${status};; esac`,
    `if [ "$FORGER_ROLE" = worker ]; then echo "${HOOK_LINE_MARK} (status $${status}); this call is refused" >&2; exit 2; fi`,
    `echo "${HOOK_LINE_MARK} (status $${status}); this session is not guarded" >&2`,
    `exit $${status}`,
  ].join('; ');
}

/** Whether a command already carries the fail-closed decision. */
export function failsClosed(command: string): boolean {
  return command.includes(HOOK_LINE_MARK);
}

/** The command to write for `command`: itself when it already fails closed, the wrapped call otherwise. */
export function closedHookLine(command: string): string {
  return failsClosed(command) ? command : hookCommandLine(command);
}
