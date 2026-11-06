import {planLine, type StoredPlan} from '../pipeline';

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
  /** The decided outcome status; absent while the run is still being judged. */
  status?: string;
  /** When the run started (ISO), so overlapping runs can be told apart. */
  startedAt?: string;
  /** The parallelism setting in force when the run started. */
  parallelism?: number;
  /** The resolved pipeline plan the run started with. */
  plan?: StoredPlan | null;
  /** Where a timed-out worker got to; only a timed-out run's log prints it. */
  progress?: TimeoutProgress;
}

export interface TimeoutProgress {
  branch: string | null;
  /** The newest commits on the branch, one line each. */
  commits: string[];
  pr: {number: number; state: string} | null;
}

function outcome(f: IterationLogFacts): string {
  if (f.timedOut) {
    const by = f.signal ? `, ended by ${f.signal}` : `, exit code ${f.exitCode}`;
    return `timed out after ${f.timeoutMinutes} minutes${by}`;
  }
  if (f.signal) return `ended by ${f.signal}`;
  return `exited with code ${f.exitCode}`;
}

function progressLines(f: IterationLogFacts): string[] {
  if (!f.timedOut || !f.progress) return [];
  const {branch, commits, pr} = f.progress;
  return [
    `branch: ${branch ?? 'none'}`,
    ...(commits.length > 0 ? ['last commits:', ...commits.map(c => `  ${c}`)] : ['last commits: none']),
    `pr: ${pr ? `#${pr.number} ${pr.state}` : 'none'}`,
  ];
}

export function formatIterationLog(f: IterationLogFacts): string {
  const body = f.output === '' ? '(no output captured)\n' : f.output;
  return [
    `=== forger iteration ${f.iteration} ===`,
    `ticket: ${f.ticket ?? 'none picked'}`,
    ...(f.enginePick !== undefined ? [`engine pick: ${f.enginePick ?? 'none'}`] : []),
    ...(f.startedAt !== undefined ? [`started: ${f.startedAt}`] : []),
    ...(f.parallelism !== undefined ? [`parallelism: ${f.parallelism}`] : []),
    ...(f.plan ? [`plan: ${planLine(f.plan)}`] : []),
    `elapsed: ${f.elapsedSeconds}s`,
    `outcome: ${outcome(f)}`,
    ...progressLines(f),
    ...(f.status !== undefined ? [`status: ${f.status}`] : []),
    '=== output ===',
    body.endsWith('\n') ? body : `${body}\n`,
  ].join('\n');
}
