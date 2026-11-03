import {formatFacts, gatherLoopFacts} from '../supervisor';
import type {Command} from './command';

export const facts: Command = {
  name: 'facts',
  needs: 'loop',
  flags: ['json', 'issue', 'pr'],
  help: `  facts [--json] [--issue N] [--pr N]
                   Read-only: branch, clean, origin base head, issue -> closing PR -> merged,
                   and a PR's CI conclusion with whether it allows a merge`,
  run(ctx) {
    const {values, config} = ctx;
    const {state, log, output, halt, lock, events, declined, verdicts} = config.paths;
    const num = (v: string | undefined) => {
      const n = v === undefined ? NaN : parseInt(v, 10);
      return Number.isNaN(n) ? undefined : n;
    };
    const facts = gatherLoopFacts(ctx.run(), {
      baseBranch: config.base_branch,
      ignore: [state, log, output, halt, lock, events, declined, verdicts, ...config.local_only],
      issue: num(values.issue),
      pr: num(values.pr),
    });
    console.log(values.json ? JSON.stringify(facts) : formatFacts(facts));
  },
};
