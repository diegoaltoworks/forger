import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {branchPr, branchTicket, CATALOGUE_PATH, checkCatalogue, factsOnMerge, parseCatalogue, ticketsOf, trackerFacts, updateCatalogue} from '../catalogue';
import type {Command} from './command';

export const catalogue: Command = {
  name: 'catalogue',
  needs: 'root',
  flags: ['json', 'update'],
  help: `  catalogue [--json] [--update]
                   List the failure catalogue's Open and Fixed rows; --update asks the tracker and moves
                   each row to the table it belongs in (Fixed once every issue is closed by a merged PR,
                   naming the PRs; Open again when an issue is open). On a ticket's branch with an open PR, a
                   row whose only open issue is the ticket moves to Fixed naming that PR; exit non-zero when the catalogue
                   and the tracker disagree`,
  run(ctx) {
    const path = join(ctx.projectRoot, CATALOGUE_PATH);
    if (!existsSync(path)) {
      console.error(`catalogue: ${CATALOGUE_PATH} does not exist`);
      process.exitCode = 1;
      return;
    }
    const text = readFileSync(path, 'utf-8');
    const run = ctx.run();
    const tracker = trackerFacts(run, ticketsOf(text));
    const ticket = branchTicket(run);
    const pr = ticket === null ? null : branchPr(run);
    const facts = tracker && factsOnMerge(text, tracker, ticket, pr);
    if (!tracker || !facts) {
      console.error('catalogue: the tracker could not be reached (gh needs a repository and a token)');
      process.exitCode = 1;
      return;
    }
    const next = ctx.values.update ? updateCatalogue(text, facts) : text;
    if (next !== text) writeFileSync(path, next);
    const problems = checkCatalogue(next, tracker, ticket, pr);
    const parsed = parseCatalogue(next);
    const entries = [
      ...parsed.open.map(r => ({title: r.title, status: 'open', issues: r.tickets, prs: r.prs})),
      ...parsed.fixed.map(r => ({title: r.title, status: 'fixed', issues: r.tickets, prs: r.prs})),
    ];
    if (ctx.values.json) console.log(JSON.stringify({updated: next !== text, entries, problems}));
    else {
      for (const e of entries) console.log(`${e.status}\t${e.title}`);
      for (const p of problems) console.error(`${CATALOGUE_PATH}:${p.line}: ${p.rule}: ${p.detail}`);
      if (next !== text) console.log(`catalogue: updated ${CATALOGUE_PATH}`);
    }
    if (problems.length > 0) process.exitCode = 1;
  },
};
