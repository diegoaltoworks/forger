/**
 * The per-iteration log file. Written for every run, including a timeout, so a
 * run that was cut off still says what it was doing. Pure; the runner writes it.
 */

export interface IterationLogFacts {
  iteration: number;
  /** The ticket the worker took, from git, else the engine's pick. */
  ticket: string | null;
  enginePick?: string | null;
  elapsedSeconds: number;
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  timeoutMinutes: number;
  output: string;
}

function outcome(f: IterationLogFacts): string {
  if (f.timedOut) {
    const by = f.signal ? `, ended by ${f.signal}` : `, exit code ${f.exitCode}`;
    return `timed out after ${f.timeoutMinutes} minutes${by}`;
  }
  if (f.signal) return `ended by ${f.signal}`;
  return `exited with code ${f.exitCode}`;
}

export function formatIterationLog(f: IterationLogFacts): string {
  const body = f.output === '' ? '(no output captured)\n' : f.output;
  return [
    `=== forger iteration ${f.iteration} ===`,
    `ticket: ${f.ticket ?? 'none picked'}`,
    ...(f.enginePick !== undefined ? [`engine pick: ${f.enginePick ?? 'none'}`] : []),
    `elapsed: ${f.elapsedSeconds}s`,
    `outcome: ${outcome(f)}`,
    '=== output ===',
    body.endsWith('\n') ? body : `${body}\n`,
  ].join('\n');
}
