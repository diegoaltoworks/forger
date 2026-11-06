import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {SANDBOX_IDS, dockerCheck, modelCredential} from '../adapters';
import {CONFIG_FILE, detectLayout, type CredentialKind} from '../config';
import type {CapturingRunner, Harness} from '../ports';

export interface SandboxSetup {
  sandbox: string;
  /** Set for `docker`: whether the Docker API answered, and what to do when it did not. */
  docker?: {reachable: boolean; fix: string[]};
}

/** Records the sandbox in the config and, for docker, checks the API. Throws on an id that is not shipped. */
export function setupSandbox(projectRoot: string, id: string, run: CapturingRunner): SandboxSetup {
  if (!SANDBOX_IDS.includes(id)) throw new Error(`Unknown sandbox "${id}"; available: ${SANDBOX_IDS.join(', ')}`);
  const file = join(projectRoot, detectLayout(projectRoot).dir, CONFIG_FILE);
  if (existsSync(file)) {
    const config = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    config.sandbox = id;
    writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  }
  if (id !== 'docker') return {sandbox: id};
  const check = dockerCheck(run('docker info --format {{.ServerVersion}}'));
  return {sandbox: id, docker: {reachable: check.ok, fix: check.fix}};
}

export function formatSandboxSetup(s: SandboxSetup): string[] {
  const lines = [`sandbox ${s.sandbox}`];
  if (s.docker && !s.docker.reachable) lines.push(...s.docker.fix.map(f => `! ${f}`));
  return lines;
}

export interface CredentialSetup {
  harness: string;
  kind: CredentialKind;
  /** The variables the container receives for it. */
  variables: string[];
  howTo: string;
}

/** Records which kind of model credential the harness uses. Throws on an unknown kind or one the harness has no variable for. */
export function setupCredential(projectRoot: string, harness: Harness, kind: string): CredentialSetup {
  if (kind !== 'api_key' && kind !== 'subscription') throw new Error(`Unknown credential kind "${kind}"; available: api_key, subscription`);
  const chosen = modelCredential(harness, kind);
  if (!chosen.ok) throw new Error(chosen.error);
  const file = join(projectRoot, detectLayout(projectRoot).dir, CONFIG_FILE);
  if (existsSync(file)) {
    const config = JSON.parse(readFileSync(file, 'utf-8')) as {credentials?: {model?: Record<string, string>}};
    config.credentials = {...config.credentials, model: {...config.credentials?.model, [harness.id]: kind}};
    writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  }
  return {harness: harness.id, kind, variables: chosen.variables, howTo: harness.credentials.howTo};
}

export function formatCredentialSetup(c: CredentialSetup): string[] {
  return [`credential ${c.harness} ${c.kind}: ${c.variables.join(' or ')}`, ...(c.kind === 'subscription' ? [`  to make it: ${c.howTo}`] : [])];
}
