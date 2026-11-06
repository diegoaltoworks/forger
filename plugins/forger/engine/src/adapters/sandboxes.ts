/** The sandbox backends forger ships, by the id the config's `sandbox` key names. */

import type {WorkloopConfig} from '../config';
import type {CapturingRunner, Sandbox} from '../ports';
import {credentialPlan, type CredentialPlan} from './credentials';
import {CREDENTIAL_VARIABLES} from './docker-plan';
import {dockerSandbox} from './docker-sandbox';
import {findHarness} from './harnesses';
import {hostSandbox} from './host-sandbox';
import {redactingSandbox} from './redacting-sandbox';

export const SANDBOX_IDS = ['host', 'docker'];

/** What a backend that leaves the host needs to know about the repository, the plugin and the credentials. */
export interface SandboxSite {
  projectRoot: string;
  pluginRoot: string;
  baseBranch: string;
  credentials?: CredentialPlan;
}

/** The site for the configured harness and credentials. */
export function sandboxSite(config: Pick<WorkloopConfig, 'base_branch' | 'harness' | 'credentials'>, projectRoot: string, pluginRoot: string): SandboxSite {
  return {projectRoot, pluginRoot, baseBranch: config.base_branch, credentials: credentialPlan(config, findHarness(config.harness))};
}

/** A backend whose output has every credential value redacted. */
export function sandboxFor(id: string, git: CapturingRunner, site?: SandboxSite): Sandbox {
  const known = new Set<string>();
  const names = site?.credentials ? [...site.credentials.variables, site.credentials.github.variable, 'GH_TOKEN', 'GITHUB_TOKEN'] : CREDENTIAL_VARIABLES;
  if (id === 'host') return redactingSandbox(hostSandbox(git), known, names);
  if (id === 'docker') {
    if (!site) throw new Error('The docker sandbox needs the project root, the plugin root and the base branch');
    return redactingSandbox(dockerSandbox(git, {...site, secrets: known}), known, names);
  }
  throw new Error(`Unknown sandbox "${id}"; available: ${SANDBOX_IDS.join(', ')}`);
}

