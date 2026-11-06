/**
 * The `host` sandbox: a git worktree, the worker as its own process group on
 * this machine, and the timeout. It is what the runner did before the seam.
 */

import type {CapturingRunner, Sandbox} from '../ports';
import {worktreeWorkspace} from '../loop';
import {runSupervised} from './supervise';

export function hostSandbox(git: CapturingRunner): Sandbox {
  return {
    id: 'host',
    ...worktreeWorkspace(git),
    start(spec) {
      const own = new AbortController();
      const abort = spec.abort ? AbortSignal.any([spec.abort, own.signal]) : own.signal;
      return {result: runSupervised({...spec, abort}), end: () => own.abort()};
    },
  };
}
