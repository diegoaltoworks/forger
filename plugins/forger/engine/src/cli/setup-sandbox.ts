import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {SANDBOX_IDS, dockerCheck} from '../adapters';
import {CONFIG_FILE, detectLayout} from '../config';
import type {CapturingRunner} from '../ports';

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
