/**
 * `setup`: installs forger's opinions into a project as files the project owns.
 * Nothing that already exists is overwritten, so a second run writes nothing.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

export interface SetupOptions {
  gates?: string;
  baseBranch?: string;
  trackerKind?: string;
  /** Skill slots to map, from a preset. */
  skills?: Record<string, string>;
}

export interface SetupEntry {
  path: string;
  action: 'written' | 'kept';
}

export interface SetupResult {
  files: SetupEntry[];
  gitignore: {added: string[]; kept: string[]};
}

const DOCS_CHECK_MARKER = 'check docs';

/** Per-run files a project never commits. */
export const GITIGNORE_LINES = [
  '.claude/state.json',
  '.claude/work.log',
  '.claude/output/',
  '.claude/HALT',
  '.claude/runner.lock',
  '.claude/events.jsonl',
];

const COPIED: ReadonlyArray<[source: string, target: string]> = [
  ['process.md', '.claude/process.md'],
  ['backlog.json', '.claude/backlog.json'],
  ['ticket.md', '.claude/templates/ticket.md'],
  ['pr.md', '.claude/templates/pr.md'],
  ['work-order.md', '.claude/templates/work-order.md'],
  ['report.md', '.claude/templates/report.md'],
  ['retro.md', '.claude/templates/retro.md'],
  ['rule.md', '.claude/templates/rule.md'],
];

/** The gates always end with the docs check, run from the plugin that is installed now. */
export function withDocsCheck(gates: string, docsCheckCommand: string): string {
  if (gates.includes(DOCS_CHECK_MARKER)) return gates;
  return gates.trim() === '' ? docsCheckCommand : `${gates} && ${docsCheckCommand}`;
}

export function renderConfig(template: string, opts: SetupOptions, docsCheckCommand: string): string {
  const config = JSON.parse(template) as Record<string, unknown> & {
    gates: string;
    tracker: Record<string, unknown>;
  };
  config.gates = withDocsCheck(opts.gates ?? config.gates, docsCheckCommand);
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
  const docsCheck = `bun ${join(pluginRoot, 'bin', 'work.ts')} check docs`;

  const files: SetupEntry[] = [
    {
      path: '.claude/workloop.config.json',
      action: writeIfAbsent(join(projectRoot, '.claude/workloop.config.json'), () =>
        renderConfig(read('workloop.config.json'), opts, docsCheck)
      ),
    },
  ];
  for (const [source, target] of COPIED) {
    files.push({path: target, action: writeIfAbsent(join(projectRoot, target), () => read(source))});
  }

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
