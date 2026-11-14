import {issueOfTicket, mergePr, mergeMode, verdictsHome, workerIdentity} from '../loop';
import type {CommandRunner} from '../ports';
import type {Command} from './command';
import {refuseChangedEngine} from './verify';

/** The ticket body of the worker calling `merge`; null when the caller is no worker or the issue cannot be read. */
function workerTicketBody(run: CommandRunner): string | null {
  const issue = issueOfTicket(workerIdentity(process.env)?.ticket ?? null);
  if (issue === null) return null;
  try {
    return run(`gh issue view ${issue} --json body --jq .body`);
  } catch {
    return null;
  }
}

export const merge: Command = {
  name: 'merge',
  needs: 'config',
  flags: ['json', 'pr', 'timeout'],
  help: `  merge --pr N [--json] [--timeout S]
                   Wait for every check on the PR to finish, squash-merge only if all passed
                   (exit 1 when it refuses: the ticket says owner reviews, a failed check, still pending at the timeout,
                   or no passing verify verdict for the PR head, or uncommitted changes in the engine's own source that outlast limits.engineChangedWaitSeconds)`,
  async run(ctx) {
    const {values, config} = ctx;
    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    if (Number.isNaN(pr)) {
      console.error('Usage: merge --pr N [--json] [--timeout S]');
      process.exitCode = 1;
      return;
    }
    if (await refuseChangedEngine(ctx, 'merge')) return;
    const r = await mergePr(ctx.run(), {
      pr,
      baseBranch: config.base_branch,
      verdictsDir: verdictsHome(ctx.run(), ctx.projectRoot, config.paths.verdicts),
      timeoutMs: parseInt(values.timeout as string, 10) * 1000,
      mode: mergeMode(workerTicketBody(ctx.run())),
    });
    if (!r.merged) process.exitCode = 1;
    console.log(values.json ? JSON.stringify(r) : r.merged ? `PR #${r.pr} merged, checks ${r.checks}` : `PR #${r.pr} not merged: ${r.reason}`);
  },
};
