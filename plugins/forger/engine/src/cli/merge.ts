import {ticketNaming} from '../config';
import {issueOfTicket, mergePr, mergeMode, verdictsHome, workerIdentity} from '../loop';
import type {CommandRunner} from '../ports';
import {githubTracker} from '../tracker';
import type {Command} from './command';
import {moveWorkerTicket, refuseChangedEngine, refuseOtherEngine} from './verify';

/** The ticket body of the worker calling `merge`; null when the caller is no worker or the issue cannot be read. */
function workerTicketBody(run: CommandRunner, env: Record<string, string | undefined>): string | null {
  const issue = issueOfTicket(workerIdentity(env)?.ticket ?? null);
  if (issue === null) return null;
  try {
    return githubTracker(run).text(issue);
  } catch {
    return null;
  }
}

/** The pull request's address, or nothing when it cannot be read. */
function prAddress(run: CommandRunner, pr: number): string | undefined {
  try {
    return run(`gh pr view ${pr} --json url --jq .url`).trim() || undefined;
  } catch {
    return undefined;
  }
}

export const merge: Command = {
  name: 'merge',
  needs: 'config',
  flags: ['json', 'pr', 'timeout'],
  help: `  merge --pr N [--json] [--timeout S]
                   Wait for every check on the PR to finish, squash-merge only if all passed
                   (exit 1 when it refuses: the ticket says owner reviews, a failed check, still pending at the timeout,
                   or no passing verify verdict for the PR head, or uncommitted changes in the engine's own source that outlast limits.engineChangedWaitSeconds,
                   or a worker running it from another engine than the one that started it: worker_denied is recorded and the command to run is printed)`,
  async run(ctx) {
    const {values, config} = ctx;
    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    if (Number.isNaN(pr)) {
      console.error('Usage: merge --pr N [--json] [--timeout S]');
      process.exitCode = 1;
      return;
    }
    if (refuseOtherEngine(ctx, 'merge') || (await refuseChangedEngine(ctx, 'merge'))) return;
    const r = await mergePr(ctx.run(), {
      pr,
      baseBranch: config.base_branch,
      verdictsDir: verdictsHome(ctx.run(), ctx.projectRoot, config.paths.verdicts),
      timeoutMs: parseInt(values.timeout as string, 10) * 1000,
      ticketNaming: ticketNaming(ctx.config),
      mode: mergeMode(workerTicketBody(ctx.run(), ctx.deps.env ?? process.env)),
    });
    if (!r.merged) process.exitCode = 1;
    else moveWorkerTicket(ctx, 'done', prAddress(ctx.run(), pr));
    console.log(values.json ? JSON.stringify(r) : r.merged ? `PR #${r.pr} merged, checks ${r.checks}` : `PR #${r.pr} not merged: ${r.reason}`);
  },
};
