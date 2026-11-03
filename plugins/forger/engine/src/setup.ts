/**
 * `setup`: installs forger's opinions into a project as files the project owns.
 * Nothing that already exists is overwritten, so a second run writes nothing.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import {LOCK_PATH, loadPacks, mergeLock, parseLock, renderLock, selectPacks, sha256, type Lock, type LockedFile} from './packs';

export interface SetupOptions {
  gates?: string;
  baseBranch?: string;
  trackerKind?: string;
  /** Skill slots to map, from a preset. */
  skills?: Record<string, string>;
  /** Pack ids to install; defaults to `base`. */
  packs?: string[];
}

export interface SetupEntry {
  path: string;
  action: 'written' | 'kept';
}

export interface SetupResult {
  files: SetupEntry[];
  gitignore: {added: string[]; kept: string[]};
}

const CHECK_MARKER = /\bwork\.ts\s+check\b|\bcheck docs\b/;

/** Per-run files a project never commits. */
export const GITIGNORE_LINES = [
  '.claude/state.json',
  '.claude/work.log',
  '.claude/output/',
  '.claude/HALT',
  '.claude/runner.lock',
  '.claude/events.jsonl',
];

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
  if (opts.skills) config.skills = {...opts.skills};
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

export function runSetup(projectRoot: string, pluginRoot: string, opts: SetupOptions): SetupResult {
  const templates = join(pluginRoot, 'templates');
  const read = (name: string) => readFileSync(join(templates, name), 'utf-8');
  const check = `bun ${join(pluginRoot, 'bin', 'work.ts')} check`;

  const {packs, unknown} = selectPacks(loadPacks(pluginRoot), opts.packs ?? ['base']);
  if (unknown.length > 0) throw new Error(`Unknown pack: ${unknown.join(', ')}`);

  const files: SetupEntry[] = [
    {
      path: '.claude/workloop.config.json',
      action: writeIfAbsent(join(projectRoot, '.claude/workloop.config.json'), () =>
        renderConfig(read('workloop.config.json'), opts, check)
      ),
    },
  ];
  const installs = packs.map(({manifest, dir}) => {
    const written: LockedFile[] = [];
    for (const f of manifest.files) {
      const content = readFileSync(join(dir, f.source), 'utf-8');
      const action = writeIfAbsent(join(projectRoot, f.target), () => content);
      files.push({path: f.target, action});
      if (action === 'written') written.push({path: f.target, sha256: sha256(content)});
    }
    return {manifest, written};
  });

  const lockPath = join(projectRoot, LOCK_PATH);
  const before: Lock = existsSync(lockPath) ? parseLock(readFileSync(lockPath, 'utf-8')) : {packs: []};
  const lockText = renderLock(mergeLock(before, installs));
  const lockExists = existsSync(lockPath);
  const lockChanged = !lockExists || readFileSync(lockPath, 'utf-8') !== lockText;
  if (lockChanged) {
    mkdirSync(dirname(lockPath), {recursive: true});
    writeFileSync(lockPath, lockText);
  }
  files.push({path: LOCK_PATH, action: lockChanged ? 'written' : 'kept'});

  const ignorePath = join(projectRoot, '.gitignore');
  const merged = mergeGitignore(existsSync(ignorePath) ? readFileSync(ignorePath, 'utf-8') : '', GITIGNORE_LINES);
  if (merged.added.length > 0) writeFileSync(ignorePath, merged.text);
  return {files, gitignore: {added: merged.added, kept: merged.kept}};
}

export function formatSetup(result: SetupResult, offeredPresets: string[] = []): string {
  const lines = result.files.map(f => `${f.action.padEnd(7)} ${f.path}`);
  lines.push(...result.gitignore.added.map(l => `ignored ${l}`));
  lines.push(...offeredPresets.map(p => `preset available: ${p} (setup --preset ${p})`));
  return lines.join('\n');
}
