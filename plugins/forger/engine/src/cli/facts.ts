import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {journeysOf} from '../checks';
import {PRODUCT_BRIEF_PATH, parseProductBrief} from '../intent';
import {parseAllEvents, formatGuardsReport, guardGlobsOf, guardsReport, testGlobsOf} from '../loop';
import {formatFacts, gatherLoopFacts} from '../supervisor';
import type {Command} from './command';

export const facts: Command = {
  name: 'facts',
  needs: 'loop',
  flags: ['json', 'issue', 'pr', 'guards', 'product'],
  help: `  facts [--json] [--issue N] [--pr N] [--guards PATH...] [--product]
                   Read-only: branch, clean, origin base head, issue -> closing PR -> merged,
                   and a PR's CI conclusion with whether it allows a merge;
                   --guards lists the guard files, the test files that name any PATH and the journeys whose paths match;
                   --product prints, as JSON, the parsed product brief (docs/product.md) or {"present": false}`,
  run(ctx) {
    const {values, config} = ctx;
    if (values.product) {
      const file = join(ctx.projectRoot, PRODUCT_BRIEF_PATH);
      const report = existsSync(file) ? {present: true, ...parseProductBrief(readFileSync(file, 'utf-8'))} : {present: false};
      console.log(JSON.stringify(report));
      return;
    }
    if (values.guards !== undefined) {
      const root = ctx.projectRoot;
      const paths = [values.guards, ...ctx.positionals.slice(1)].flatMap(p => p.split(',')).filter(p => p !== '');
      const files = ctx.run()('git ls-files').split('\n').filter(f => f !== '');
      const report = guardsReport(paths, files, guardGlobsOf(root, config), testGlobsOf(root), f => readFileSync(join(root, f), 'utf-8'), journeysOf(root));
      console.log(values.json ? JSON.stringify(report) : formatGuardsReport(report));
      return;
    }
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
      events: parseAllEvents(ctx.stateStore.readEvents()),
    });
    console.log(values.json ? JSON.stringify(facts) : formatFacts(facts));
  },
};
