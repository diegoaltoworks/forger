/**
 * Where a worker runs and under what limits. The `Harness` decides what command
 * runs; a `Sandbox` prepares the workspace, starts the command in it, ends it
 * and cleans up. The runner and the verifier start workers only through it.
 */

import type {SupervisedResult} from './agent';

export interface WorkspaceRequest {
  ticket: string;
  baseBranch: string;
  /** The folder beside the engine's state where workspaces live. */
  stateDir: string;
}

export type Workspace = {ok: true; ticket: string; path: string} | {ok: false; ticket: string; error: string};

export interface SandboxStart {
  command: string;
  args: string[];
  /** The workspace path the command runs in. */
  cwd: string;
  /** Added to the inherited environment. */
  env?: Record<string, string>;
  input: string;
  timeoutMs: number;
  /** Time between the stop signal and the kill once the deadline passes. */
  graceMs: number;
  spendLimitUsd?: number;
  spentUsd?: (output: string) => number | null;
  /** Ends the worker like a deadline does, without marking the run timed out. */
  abort?: AbortSignal;
  /** The run only reads: a sandbox that leaves the host gives it a GitHub token that cannot push or write. */
  readOnly?: boolean;
  /** A ref of origin to check out instead of the ticket branch. */
  ref?: string;
}

export interface RunningWorker {
  result: Promise<SupervisedResult>;
  /** Ends the worker and everything it started. */
  end(): void;
}

export interface Sandbox {
  id: string;
  prepare(request: WorkspaceRequest): Workspace;
  start(spec: SandboxStart): RunningWorker;
  /** Removes the workspace; `dropBranch` also drops the ticket's branch. Returns why it failed, or null. */
  cleanup(request: WorkspaceRequest, dropBranch: boolean): string | null;
}
