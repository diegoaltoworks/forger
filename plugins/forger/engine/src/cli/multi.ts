import {existsSync} from 'fs';
import {resolve} from 'path';

import {gitStateStore, localStateFor} from '../adapters';
import {loadConfig} from '../config';
import {parseWatchedEvents} from '../loop';
import {followEvents, formatMultiReport, mergeReports, repoNames, type FollowedRepo, type Report, type RepoReport} from '../supervisor';
import type {CommandContext} from './command';

const LOCAL_POLL_MS = 1000;
// A read of the state branch is a fetch, so it is polled far less often than a local file.
const BRANCH_POLL_MS = 15_000;

export function reposOf(ctx: CommandContext): string[] {
  const paths = (ctx.values.repos ?? '').split(',').map(s => s.trim()).filter(Boolean).map(p => resolve(p));
  if (paths.length === 0) throw new Error('--repos needs one or more repository paths, comma separated');
  const missing = paths.filter(p => !existsSync(p));
  if (missing.length) throw new Error(`--repos: no such directory: ${missing.join(', ')}`);
  return paths;
}

function followedRepo(name: string, path: string): FollowedRepo {
  const config = loadConfig(path);
  const branch = config.state.home === 'branch';
  const store = branch ? gitStateStore({repo: path, branch: config.state.branch}) : localStateFor(path, config);
  return {name, read: () => parseWatchedEvents(store.readEvents()), pollMs: branch ? BRANCH_POLL_MS : LOCAL_POLL_MS};
}

export async function watchRepos(ctx: CommandContext): Promise<void> {
  const paths = reposOf(ctx);
  const names = repoNames(paths);
  const repos = paths.map((p, i) => followedRepo(names[i]!, p));
  await followEvents({repos, emit: line => console.log(line), timeoutMs: parseInt(ctx.values.timeout as string, 10) * 1000});
  process.exitCode = 2;
}

/** One repository's report, produced by the same command run in that repository. */
function reportOf(path: string, ctx: CommandContext): Report {
  const args = ['report', '--json', ...(ctx.values.since !== undefined ? ['--since', ctx.values.since] : []), ...(ctx.values.from !== undefined ? ['--from', ctx.values.from] : [])];
  const out = Bun.spawnSync(['bun', resolve(ctx.pluginRoot, 'bin/work.ts'), ...args], {cwd: path, stdout: 'pipe', stderr: 'pipe'});
  if (out.exitCode !== 0) throw new Error(out.stderr.toString().trim() || `report exited ${out.exitCode}`);
  return JSON.parse(out.stdout.toString()) as Report;
}

export function reportRepos(ctx: CommandContext): void {
  const paths = reposOf(ctx);
  const names = repoNames(paths);
  const reports: RepoReport[] = paths.map((p, i) => {
    try {
      return {repo: names[i]!, report: reportOf(p, ctx)};
    } catch (err) {
      return {repo: names[i]!, report: {error: err instanceof Error ? err.message : String(err)}};
    }
  });
  const merged = mergeReports(reports);
  console.log(ctx.values.json ? JSON.stringify(merged) : formatMultiReport(merged));
}
