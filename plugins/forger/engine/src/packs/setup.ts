/**
 * `setup`: installs forger's opinions into a project as files the project owns.
 * Nothing that already exists is overwritten, so a second run writes nothing.
 */

import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import {DEFAULT_PACKS, LOCK_PATH, loadPacks, mergeLock, parseLock, renderLock, selectPacks, sha256, type Lock, type LockedFile} from './packs';
import type {CommandRunner, Harness} from '../ports';
import {installStarter, withStarterPacks, type StarterManifest} from './starter';
import {finishStructure, formatStructureSetup, type StructureSetup} from './structure-defaults';
import {CONFIG_FILE, FORGER_DIR, detectLayout, forgerPath} from '../config';

export interface SetupOptions {
  gates?: string;
  baseBranch?: string;
  trackerKind?: string;
  /** The flavour to record in the config, as `<name>@<version>`. */
  flavour?: string;
  /** Pack ids to install; defaults to DEFAULT_PACKS. */
  packs?: string[];
  /** The harness the worker runs in; its commands are installed where it reads them. */
  harness?: Harness;
  /** The harness whose settings get forger's tool-call hook, for workers and the supervisor alike. */
  hookHarness?: Harness;
  /** Lists the project's files; with it, installing the structure pack records its baseline. */
  run?: CommandRunner;
  /** A starter to copy first; its gates and packs apply unless the caller named its own. */
  starter?: StarterManifest;
}

export interface SetupEntry {
  path: string;
  action: 'written' | 'kept';
}

export interface SetupResult {
  files: SetupEntry[];
  gitignore: {added: string[]; kept: string[]};
  structure?: StructureSetup;
  /** The starter copied, when one was. */
  starter?: string;
}

const CHECK_MARKER = /\bwork\.ts\s+check\b|\bcheck docs\b/;

/** The engine exports the plugin's root under this name to the processes that run the gates. */
export const PLUGIN_ROOT_VAR = 'FORGER_PLUGIN_ROOT'; // same name as loop/worker-env.ts, which exports it

/** The check command the gates end with: it names the variable, so the committed line holds no machine path. */
export const CHECK_COMMAND = 'bun "$' + PLUGIN_ROOT_VAR + '/bin/work.ts" check';

/** The hook command the committed harness settings hold: it names the variable, so the file works on every clone. */
export const HOOK_COMMAND_LINE = 'bun "$' + PLUGIN_ROOT_VAR + '/bin/work.ts" hook';

const ABSOLUTE_CHECK = /\bbun\s+"?[/~][^\s"]*\/bin\/work\.ts"?\s+check\b/g;

/** Gates written by an older setup name the plugin by absolute path; this swaps them for the variable form. */
export function relocatableGates(gates: string): string {
  return gates.replace(ABSOLUTE_CHECK, () => CHECK_COMMAND);
}

/** Per-run files a project never commits. */
export function gitignoreLines(dir: string): string[] {
  return ['state.json', 'work.log', 'output/', 'HALT', 'runner.lock', 'events.jsonl', 'declined.json', 'verdicts/', 'tmp/', 'checks.jsonl', 'worktrees/'].map(f => `${dir}/${f}`);
}

/** Runtime files git still tracks: an ignore line does not stop tracking a committed file. Unreadable git state reports none. */
export function trackedRuntimeFiles(projectRoot: string, run: CommandRunner): string[] {
  const dir = detectLayout(projectRoot).dir;
  const files = gitignoreLines(dir).filter(l => !l.endsWith('/'));
  const dirs = gitignoreLines(dir).filter(l => l.endsWith('/'));
  try {
    const out = run(`git ls-files -- ${[...files, ...dirs].map(f => `'${f}'`).join(' ')}`);
    return out.split('\n').map(l => l.trim()).filter(l => l !== '');
  } catch {
    return [];
  }
}

export function formatTrackedRuntime(files: string[]): string[] {
  return files.map(f => `! git tracks ${f}; stop tracking it and keep the file with: git rm --cached ${f}`);
}

/** The gates always end with the check command, run from the plugin that is installed now. */
export function withCheck(gates: string, checkCommand: string): string {
  if (CHECK_MARKER.test(gates)) return gates;
  return gates.trim() === '' ? checkCommand : `${gates} && ${checkCommand}`;
}

export function renderConfig(template: string, opts: SetupOptions, checkCommand: string): string {
  const config = JSON.parse(template) as Record<string, unknown> & {
    gates: string;
    tracker: Record<string, unknown>;
  };
  config.gates = withCheck(opts.gates ?? config.gates, checkCommand);
  if (opts.baseBranch) config.base_branch = opts.baseBranch;
  if (opts.flavour) config.flavour = opts.flavour;
  if (opts.harness) config.harness = opts.harness.id;
  if (opts.trackerKind) config.tracker = {...config.tracker, kind: opts.trackerKind};
  return JSON.stringify(config, null, 2) + '\n';
}

/** Appends the lines that are missing; reports what it added and what was already there. */
export function mergeGitignore(existing: string, lines: string[]): {text: string; added: string[]; kept: string[]} {
  const present = new Set(existing.split('\n').map(l => l.trim()));
  const added = lines.filter(l => !present.has(l));
  const kept = lines.filter(l => present.has(l));
  if (added.length === 0) return {text: existing, added, kept};
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  return {text: existing + sep + added.join('\n') + '\n', added, kept};
}

function writeIfAbsent(path: string, content: () => string): 'written' | 'kept' {
  if (existsSync(path)) return 'kept';
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, content());
  return 'written';
}

/** The plugin's commands in the harness's format, where it reads them. Derived files, so a changed one is rewritten. */
function installCommands(projectRoot: string, pluginRoot: string, harness: Harness): SetupEntry[] {
  const dir = join(pluginRoot, 'commands');
  const names = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort() : [];
  return names.flatMap((name): SetupEntry[] => {
    const rel = harness.commandPath(name);
    if (rel === null) return [];
    const target = join(projectRoot, rel);
    const content = harness.packageCommand(readFileSync(join(dir, `${name}.md`), 'utf-8'), pluginRoot, name);
    if (existsSync(target) && readFileSync(target, 'utf-8') === content) return [{path: rel, action: 'kept'}];
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, content);
    return [{path: rel, action: 'written'}];
  });
}

/** The harness's hook settings with forger's hook added; a settings file that already runs it is kept. */
function installHook(projectRoot: string, harness: Harness): SetupEntry[] {
  if (!harness.hooks) return [];
  const target = join(projectRoot, harness.hooks.path);
  const existing = existsSync(target) ? readFileSync(target, 'utf-8') : null;
  const text = harness.hooks.install(existing, HOOK_COMMAND_LINE);
  if (text === existing) return [{path: harness.hooks.path, action: 'kept'}];
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, text);
  return [{path: harness.hooks.path, action: 'written'}];
}

export function runSetup(projectRoot: string, pluginRoot: string, opts: SetupOptions): SetupResult {
  const templates = join(pluginRoot, 'templates');
  const read = (name: string) => readFileSync(join(templates, name), 'utf-8');

  const starter = opts.starter;
  const wanted = opts.packs ?? DEFAULT_PACKS;
  const {packs, unknown} = selectPacks(loadPacks(pluginRoot), starter ? withStarterPacks(wanted, starter) : wanted);
  if (unknown.length > 0) throw new Error(`Unknown pack: ${unknown.join(', ')}`);

  // First, so the starter's own journeys and files stand and the packs' empty defaults are kept.
  const files: SetupEntry[] = starter ? installStarter(projectRoot, pluginRoot, starter) : [];
  files.push({
    path: `${FORGER_DIR}/${CONFIG_FILE}`,
    action: writeIfAbsent(forgerPath(projectRoot, `${FORGER_DIR}/${CONFIG_FILE}`), () =>
      renderConfig(read('workloop.config.json'), {...opts, gates: opts.gates ?? starter?.gates}, CHECK_COMMAND)
    ),
  });
  const installs = packs.map(({manifest, dir}) => {
    const written: LockedFile[] = [];
    for (const f of manifest.files) {
      const content = readFileSync(join(dir, f.source), 'utf-8');
      const action = writeIfAbsent(forgerPath(projectRoot, f.target), () => content);
      files.push({path: f.target, action});
      if (action === 'written') written.push({path: f.target, sha256: sha256(content)});
    }
    return {manifest, written};
  });

  const lockPath = forgerPath(projectRoot, LOCK_PATH);
  const before: Lock = existsSync(lockPath) ? parseLock(readFileSync(lockPath, 'utf-8')) : {packs: []};
  const lockText = renderLock(mergeLock(before, installs));
  const lockExists = existsSync(lockPath);
  const lockChanged = !lockExists || readFileSync(lockPath, 'utf-8') !== lockText;
  if (lockChanged) {
    mkdirSync(dirname(lockPath), {recursive: true});
    writeFileSync(lockPath, lockText);
  }
  files.push({path: LOCK_PATH, action: lockChanged ? 'written' : 'kept'});

  const structure = packs.some(p => p.manifest.id === 'structure')
    ? finishStructure(projectRoot, files.some(f => f.path === '.forger/structure.json' && f.action === 'written'), opts.run)
    : undefined;

  if (opts.harness) files.push(...installCommands(projectRoot, pluginRoot, opts.harness));
  const hookHarness = opts.hookHarness ?? opts.harness;
  if (hookHarness) files.push(...installHook(projectRoot, hookHarness));

  const ignorePath = join(projectRoot, '.gitignore');
  const merged = mergeGitignore(existsSync(ignorePath) ? readFileSync(ignorePath, 'utf-8') : '', gitignoreLines(detectLayout(projectRoot).dir));
  if (merged.added.length > 0) writeFileSync(ignorePath, merged.text);
  return {files, gitignore: {added: merged.added, kept: merged.kept}, ...(structure ? {structure} : {}), ...(starter ? {starter: starter.name} : {})};
}

export function formatSetup(result: SetupResult, offeredPresets: string[] = []): string {
  const lines = result.files.map(f => `${f.action.padEnd(7)} ${f.path}`);
  lines.push(...result.gitignore.added.map(l => `ignored ${l}`));
  if (result.starter) lines.push(`starter  ${result.starter}`);
  if (result.structure) lines.push(...formatStructureSetup(result.structure));
  lines.push(...offeredPresets.map(p => `flavour available: ${p} (setup --flavour ${p})`));
  return lines.join('\n');
}
