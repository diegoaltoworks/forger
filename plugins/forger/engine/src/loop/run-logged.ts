/**
 * The command log of a verifier's copy: `run-logged` appends one JSON line per
 * command it runs, and the engine reads the file back as the record of what
 * ran. Pure parsing; the file I/O sits in the CLI command and in `verify`.
 */

import type {CommandRun} from './evidence-check';

export function logLine(run: CommandRun): string {
  return JSON.stringify(run) + '\n';
}

/** The runs in a log; a line that is not a run is skipped, so a torn write loses one entry, not the log. */
export function parseCommandLog(text: string): CommandRun[] {
  const runs: CommandRun[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Partial<CommandRun>;
      if (typeof r.command === 'string' && typeof r.exit === 'number') runs.push({command: r.command, exit: r.exit, output: typeof r.output === 'string' ? r.output : '', ...(typeof r.dir === 'string' ? {dir: r.dir} : {})});
    } catch {
      // skip
    }
  }
  return runs;
}

/** The command line for arguments run as given: one argument is the line itself, several are each quoted so they stay one word. */
export function commandLine(args: string[]): string {
  if (args.length === 1) return args[0].trim();
  return args.map(a => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

/**
 * Variables under which a test runner switches to an agent mode that prints
 * failures only. With them set, the log holds no passed test, and no test the
 * verifier cites could check out.
 */
export const QUIET_TEST_ENV = ['CLAUDECODE', 'REPL_ID', 'AGENT'];

/** The environment a logged command runs in: the caller's, without the quiet-output switches. */
export function loggedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !QUIET_TEST_ENV.includes(k)) out[k] = v;
  return out;
}
