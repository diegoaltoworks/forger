import {mergePr} from '../loop';
import type {Command} from './command';

export const merge: Command = {
  name: 'merge',
  needs: 'config',
  flags: ['json', 'pr', 'timeout'],
  help: `  merge --pr N [--json] [--timeout S]
                   Wait for every check on the PR to finish, squash-merge only if all passed
                   (exit 1 when it refuses: a failed check, still pending at the timeout)`,
  async run(ctx) {
    const {values, config} = ctx;
    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    if (Number.isNaN(pr)) {
      console.error('Usage: merge --pr N [--json] [--timeout S]');
      process.exitCode = 1;
      return;
    }
    const r = await mergePr(ctx.run(), {
      pr,
      baseBranch: config.base_branch,
      timeoutMs: parseInt(values.timeout as string, 10) * 1000,
    });
    if (!r.merged) process.exitCode = 1;
    console.log(values.json ? JSON.stringify(r) : r.merged ? `PR #${r.pr} merged, checks ${r.checks}` : `PR #${r.pr} not merged: ${r.reason}`);
  },
};
