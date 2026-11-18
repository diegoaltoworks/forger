/** The `release` command's decisions, over injected ports: it returns what to print and the exit code. */

import {filedLabels} from '../../tracker';
import type {CommandRunner, Tracker} from '../../ports';
import {changelogEntry, entryNotes, withEntry} from './changelog';
import {checkVersions, readVersions, writeVersions, type FilePort, type ReleaseFile} from './files';
import {gatherChanges} from './gather';
import {agreedVersion, changeLine, formatPlan, isBump, parseVersion, planRelease, type Bump, type PlanResult} from './plan';

export interface ReleaseSettings {
  files: ReleaseFile[];
  changelog: string;
}

export type ReleaseMode = 'plan' | 'file' | 'write' | 'check' | 'notes';

export interface ReleaseRequest {
  mode: ReleaseMode | null;
  json: boolean;
  bump?: string;
  version?: string;
}

export interface ReleaseDeps {
  settings: ReleaseSettings | undefined;
  baseBranch: string;
  intakeLabel: string;
  run: CommandRunner;
  tracker: Tracker;
  fs: FilePort;
}

export interface ReleaseOutcome {
  exitCode: number;
  out: string;
  err: string;
}

const fail = (err: string): ReleaseOutcome => ({exitCode: 1, out: '', err});
const ok = (out: string): ReleaseOutcome => ({exitCode: 0, out, err: ''});

export const RELEASE_TITLE = /^Release \d+\.\d+\.\d+$/;

/** The text of the ticket a release is: the version, the changes, and the checks that say it is written. */
export function releaseTicketBody(plan: {current: string; next: string; bump: Bump; changes: Parameters<typeof changeLine>[0][]}): string {
  return [
    `Release ${plan.next}: a ${plan.bump} bump from ${plan.current}.`,
    '',
    '## Changes',
    '',
    ...plan.changes.map(c => `- ${changeLine(c)}`),
    '',
    '## What to build',
    '',
    `Run \`release --write --version ${plan.next}\`, which writes the version into every configured file and the changelog entry on top. Change nothing else.`,
    '',
    '## Acceptance',
    '',
    `- [ ] \`bun plugins/forger/bin/work.ts release --check --version ${plan.next}\` exits 0`,
    '- [ ] Gates green',
    '',
    '## Merge',
    '',
    'when green',
    '',
  ].join('\n');
}

function planOf(deps: ReleaseDeps, settings: ReleaseSettings, override: Bump | undefined): PlanResult {
  const held = readVersions(settings.files, deps.fs);
  const agreed = agreedVersion(held);
  if (!agreed.ok) throw new Error(agreed.problem);
  const changes = gatherChanges(deps.run, deps.tracker, {baseBranch: deps.baseBranch, current: agreed.version, firstFile: settings.files[0].path});
  return planRelease(agreed.version, changes, override);
}

export function runRelease(req: ReleaseRequest, deps: ReleaseDeps): ReleaseOutcome {
  const settings = deps.settings;
  if (!settings || settings.files.length === 0) return fail('release: releases are not configured; name the version files in `release.files` of the config');
  if (req.mode === null) return fail('release: pass one of --plan, --file, --write --version V, --check --version V, --notes --version V');
  if (req.bump !== undefined && !isBump(req.bump)) return fail('release: --bump must be patch, minor or major');
  try {
    if (req.mode === 'check' || req.mode === 'write' || req.mode === 'notes') {
      if (req.version === undefined || parseVersion(req.version) === null) return fail(`release: --${req.mode} needs --version x.y.z`);
    }
    if (req.mode === 'notes') {
      const notes = entryNotes(deps.fs.read(settings.changelog), req.version as string);
      return notes === null ? fail(`release: ${settings.changelog} has no entry for ${req.version}`) : ok(notes);
    }
    if (req.mode === 'check') {
      const problems = checkVersions(settings.files, settings.changelog, req.version as string, deps.fs);
      return problems.length === 0 ? ok(`every file holds ${req.version}`) : {exitCode: 1, out: '', err: problems.join('\n')};
    }
    const result = planOf(deps, settings, req.bump as Bump | undefined);
    if (result.kind === 'nothing') {
      const text = `nothing to release: no ticket merged since ${result.current}`;
      return req.mode === 'write' ? fail(`release: ${text}`) : ok(req.json ? JSON.stringify({current: result.current, nothing: true}) : text);
    }
    const {plan} = result;
    if (req.mode === 'plan') return ok(req.json ? JSON.stringify(plan) : formatPlan(plan));
    if (req.mode === 'write') {
      const version = req.version as string;
      writeVersions(settings.files, version, deps.fs);
      deps.fs.write(settings.changelog, withEntry(deps.fs.read(settings.changelog), changelogEntry(version, plan.changes)));
      return ok(`wrote ${version} into ${[...settings.files.map(f => f.path), settings.changelog].join(', ')}`);
    }
    const open = deps.tracker.list({state: 'open', title: 'Release '}).filter(t => RELEASE_TITLE.test(t.title));
    if (open.length > 0) return ok(`a release ticket is open: #${open[0].number} ${open[0].title}; nothing filed`);
    const url = deps.tracker.apply({kind: 'file', title: `Release ${plan.next}`, body: releaseTicketBody(plan), labels: filedLabels(deps.tracker.queue, deps.intakeLabel)}).trim();
    return ok(req.json ? JSON.stringify({filed: url, next: plan.next}) : `filed the release ticket for ${plan.next}: ${url}`);
  } catch (e) {
    return fail(`release: ${(e as Error).message}`);
  }
}

/** `--file` is the release command's flag for filing the ticket; the shared flag table already takes `--file` with a value, so the command reads it as `--file-ticket`. */
export function releaseArgs(argv: string[]): string[] {
  const name = argv.find(a => !a.startsWith('-'));
  return name === 'release' ? argv.map(a => (a === '--file' ? '--file-ticket' : a)) : argv;
}
