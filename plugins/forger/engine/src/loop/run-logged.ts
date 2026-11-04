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
      if (typeof r.command === 'string' && typeof r.exit === 'number') runs.push({command: r.command, exit: r.exit, output: typeof r.output === 'string' ? r.output : ''});
    } catch {
      // skip
    }
  }
  return runs;
}
