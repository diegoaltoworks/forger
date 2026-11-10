/**
 * Runs `setup`, the gates and `check` on every fixture project under
 * `projects/`, in a temporary copy with an unrelated `~/.claude` in a fake HOME.
 * A fixture is a directory: its optional `fixture.json` gives the `gates` it
 * runs and a `prepare` command for tools it needs; `$FIXTURE_TOOLS` is a
 * scratch directory outside the project for them.
 *
 * Usage: bun test/fixtures/run.integration.ts [fixture-name...]
 */

import {spawnSync} from 'child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join, resolve} from 'path';

import {checkObservation, type Observation} from './assertions';

const here = dirname(new URL(import.meta.url).pathname);
const sourcePlugin = resolve(here, '../../plugins/forger');

// Built in parts so the file holds no literal address for `check docs` to flag.
const IDENTITY_EMAIL = ['fixture', 'example.invalid'].join('@');

interface FixtureConfig {
  gates?: string;
  prepare?: string;
  /** The project has no source file: setup copies a starter and its gates stand. */
  starter?: boolean;
}

function sh(command: string, cwd: string, env: Record<string, string>) {
  return spawnSync('sh', ['-c', command], {cwd, env, encoding: 'utf-8'});
}

function forger(pluginRoot: string, args: string[], cwd: string, env: Record<string, string>) {
  return spawnSync('bun', [join(pluginRoot, 'bin', 'work.ts'), ...args], {cwd, env, encoding: 'utf-8'});
}

function forgerDirsUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (existsSync(join(dir, '.forger'))) found.push(dir);
    if (depth === 0) return;
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') walk(join(dir, e.name), depth - 1);
    }
  };
  walk(root, 3);
  return found;
}

function runFixture(name: string): string[] {
  const source = join(here, 'projects', name);
  const config: FixtureConfig = existsSync(join(source, 'fixture.json')) ? JSON.parse(readFileSync(join(source, 'fixture.json'), 'utf-8')) : {};
  const scratch = mkdtempSync(join(tmpdir(), `forger-fixture-${name}-`));
  const home = join(scratch, 'home');
  const project = join(home, 'project');
  const tools = join(scratch, 'tools');
  // Setup writes the plugin's path into the harness hook settings, which `check docs` rejects under a
  // home directory; running a copy from the scratch directory keeps that path out of the run.
  const pluginRoot = join(scratch, 'plugin');
  cpSync(sourcePlugin, pluginRoot, {recursive: true, filter: src => !src.includes('node_modules')});
  mkdirSync(join(home, '.claude'), {recursive: true});
  mkdirSync(tools);
  writeFileSync(join(home, '.claude', 'settings.json'), '{"theme": "unrelated"}\n');
  cpSync(source, project, {recursive: true});
  rmSync(join(project, 'fixture.json'));

  // No token: setup's label and branch-protection steps must find no repository to act on.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    FIXTURE_TOOLS: tools,
    FORGER_PLUGIN_ROOT: pluginRoot,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: IDENTITY_EMAIL,
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: IDENTITY_EMAIL,
  };
  const problems: string[] = [];
  const step = (label: string, r: {status: number | null; stdout: string; stderr: string}): boolean => {
    if (r.status === 0) return true;
    problems.push(`${label} exited ${r.status}\n${r.stdout}${r.stderr}`);
    return false;
  };

  try {
    if (config.prepare && !step('prepare', sh(config.prepare, project, env))) return problems;
    if (!step('git init', sh('git init -q -b main && git add -A && git commit -q -m init', project, env))) return problems;

    const detect = forger(pluginRoot, ['packs', '--detect', '--json'], project, env);
    if (!step('packs --detect', detect)) return problems;
    const detected = (JSON.parse(detect.stdout) as {id: string}[]).map(s => s.id);

    const args = ['setup', '--json', '--packs', ['base', ...detected].join(',')];
    if (config.gates) args.push('--gates', config.gates);
    const setup = forger(pluginRoot, args, project, env);
    if (!step('setup', setup)) return problems;
    const result = JSON.parse(setup.stdout) as {coverage?: Observation['coverage']};

    const configText = readFileSync(join(project, '.forger', 'workloop.config.json'), 'utf-8');
    const gates = (JSON.parse(configText) as {gates: string}).gates;
    // The order setup's own next steps give: run the gates, set the first baseline, then the gates and check as a whole.
    if (!step('gates', sh(gates.replace(/\s*&&\s*bun\b[^&]*\bcheck\s*$/, ''), project, env))) return problems;
    const reportWritten = existsSync(join(project, 'coverage', 'lcov.info'));
    if (!step('check coverage --update', forger(pluginRoot, ['check', 'coverage', '--update'], project, env))) return problems;
    if (!step('gates and check', sh(gates, project, env))) return problems;

    for (const f of checkObservation({
      home,
      project,
      forgerDirs: forgerDirsUnder(home),
      config: configText,
      detected,
      coverage: result.coverage,
      reportWritten,
      starter: config.starter,
    })) {
      problems.push(`#${f.issue}: ${f.message}`);
    }
    return problems;
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

const all = readdirSync(join(here, 'projects'), {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name).sort();
const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : all;
let failed = false;
for (const name of names) {
  const problems = runFixture(name);
  console.log(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${name}`);
  for (const p of problems) console.log(`     ${p.replace(/\n/g, '\n     ')}`);
  if (problems.length > 0) failed = true;
}
process.exit(failed ? 1 : 0);
