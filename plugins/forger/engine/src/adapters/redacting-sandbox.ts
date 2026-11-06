/**
 * Wraps a sandbox so no credential value leaves it. Everything the engine records (the iteration log, the
 * events file, a verdict) is built from what a worker returns, so redacting the returned output at this one
 * seam keeps every record clean.
 */

import type {Sandbox} from '../ports';
import {redact} from './credentials';

/**
 * `known` holds values learned at run time (a minted token); the variables named in `names` are read from
 * `env` when a result comes back, so a value set after the wrapper was built is still covered.
 */
export function redactingSandbox(inner: Sandbox, known: Set<string>, names: string[], env: Record<string, string | undefined> = process.env): Sandbox {
  const secrets = (): string[] => [...known, ...names.map(n => env[n]).filter((v): v is string => typeof v === 'string' && v !== '')];
  return {
    ...inner,
    start(spec) {
      const running = inner.start(spec);
      const clean = (s: string): string => redact(s, secrets());
      return {end: running.end, result: running.result.then(r => ({...r, output: clean(r.output)}))};
    },
  };
}
