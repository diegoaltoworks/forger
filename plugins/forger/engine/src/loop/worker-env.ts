/**
 * What the engine tells a worker's process about itself, through its
 * environment. The harness hook reads it: a call made with the worker role is
 * held to the worker's policy, and its refusals are recorded against the
 * ticket and iteration. Pure.
 */

export const WORKER_ROLE_VAR = 'FORGER_ROLE';
export const WORKER_TICKET_VAR = 'FORGER_TICKET';
export const WORKER_ITERATION_VAR = 'FORGER_ITERATION';

/** The plugin's root, which the gates setup writes name instead of a machine path. */
export const PLUGIN_ROOT_VAR = 'FORGER_PLUGIN_ROOT';

export function workerEnv(ticket: string | null, iteration: number, pluginRoot?: string): Record<string, string> {
  return {
    [WORKER_ROLE_VAR]: 'worker',
    [WORKER_TICKET_VAR]: ticket ?? '',
    [WORKER_ITERATION_VAR]: String(iteration),
    ...(pluginRoot ? {[PLUGIN_ROOT_VAR]: pluginRoot} : {}),
  };
}

export interface WorkerIdentity {
  ticket: string | null;
  iteration: number;
}

/** The worker this process is, or null when the engine did not start it. */
export function workerIdentity(env: Record<string, string | undefined>): WorkerIdentity | null {
  if (env[WORKER_ROLE_VAR] !== 'worker') return null;
  const n = Number(env[WORKER_ITERATION_VAR]);
  return {ticket: env[WORKER_TICKET_VAR] || null, iteration: Number.isInteger(n) && n >= 0 ? n : 0};
}
