/** The sandbox backends forger ships, by the id the config's `sandbox` key names. */

import type {CapturingRunner, Sandbox} from '../ports';
import {hostSandbox} from './host-sandbox';

export const SANDBOX_IDS = ['host'];

export function sandboxFor(id: string, git: CapturingRunner): Sandbox {
  if (id === 'host') return hostSandbox(git);
  throw new Error(`Unknown sandbox "${id}"; available: ${SANDBOX_IDS.join(', ')}`);
}
