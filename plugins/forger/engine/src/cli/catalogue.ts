import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {CATALOGUE_PATH, checkCatalogue, parseCatalogue, formatStatus, ticketsOf, trackerFacts, updateCatalogue} from '../catalogue';
import type {Command} from './command';

export const catalogue: Command = {
  name: 'catalogue',
  needs: 'root',
  flags: ['json', 'update'],
  help: `  catalogue [--json] [--update]
                   List the failure catalogue's entries and their status; --update asks the tracker
                   and rewrites each entry's status line, its struck heading with the merged PRs,
                   and the generated index; exit non-zero when the catalogue and the tracker disagree`,
  run(ctx) {
    const path = join(ctx.projectRoot, CATALOGUE_PATH);
    if (!existsSync(path)) {
      console.error(`catalogue: ${CATALOGUE_PATH} does not exist`);
      process.exitCode = 1;
      return;
    }
    const text = readFileSync(path, 'utf-8');
    const facts = trackerFacts(ctx.run(), ticketsOf(text));
    if (!facts) {
      console.error('catalogue: the tracker could not be reached (gh needs a repository and a token)');
      process.exitCode = 1;
      return;
    }
    const next = ctx.values.update ? updateCatalogue(text, facts) : text;
    if (next !== text) writeFileSync(path, next);
    const problems = checkCatalogue(next, facts);
    const entries = parseCatalogue(next).map(e => ({title: e.title, status: e.status ? formatStatus(e.status) : null}));
    if (ctx.values.json) console.log(JSON.stringify({updated: next !== text, entries, problems}));
    else {
      for (const e of entries) console.log(`${e.status ?? 'no status'}\t${e.title}`);
      for (const p of problems) console.error(`${CATALOGUE_PATH}:${p.line}: ${p.rule}: ${p.detail}`);
      if (next !== text) console.log(`catalogue: updated ${CATALOGUE_PATH}`);
    }
    if (problems.length > 0) process.exitCode = 1;
  },
};
