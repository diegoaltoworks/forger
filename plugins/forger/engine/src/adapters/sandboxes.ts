/** The sandbox backends forger ships, by the id the config's `sandbox` key names. */

import type {CapturingRunner, Sandbox} from '../ports';
import {dockerSandbox} from './docker-sandbox';
import {hostSandbox} from './host-sandbox';

export const SANDBOX_IDS = ['host', 'docker'];

/** What a backend that leaves the host needs to know about the repository and the plugin. */
export interface SandboxSite {
  projectRoot: string;
  pluginRoot: string;
  baseBranch: string;
}

export function sandboxFor(id: string, git: CapturingRunner, site?: SandboxSite): Sandbox {
  if (id === 'host') return hostSandbox(git);
  if (id === 'docker') {
    if (!site) throw new Error('The docker sandbox needs the project root, the plugin root and the base branch');
    return dockerSandbox(git, site);
  }
  throw new Error(`Unknown sandbox "${id}"; available: ${SANDBOX_IDS.join(', ')}`);
}
