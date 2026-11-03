import {readFileSync, writeFileSync} from 'fs';

import {ensureClosesLine, validatePrBody} from '../loop';
import type {Command} from './command';

export const prBody: Command = {
  name: 'pr-body',
  needs: 'none',
  flags: ['json', 'file', 'issue', 'section', 'fix'],
  help: `  pr-body --file PATH [--issue N] [--section TITLE ...] [--fix] [--json]
                   Check a PR body, such as one a pr_body skill wrote, keeps "Closes #N" and the
                   ticket's review sections; --fix appends a missing closing line. Exit 1 on problems`,
  run({values}) {
    const file = values.file as string | undefined;
    if (!file) {
      console.error('pr-body: --file is required');
      process.exitCode = 1;
      return;
    }
    const raw = values.issue as string | undefined;
    const issue = raw === undefined ? null : Number(raw);
    if (issue !== null && !Number.isInteger(issue)) {
      console.error(`pr-body: --issue must be a number; got "${raw}"`);
      process.exitCode = 1;
      return;
    }
    let body = readFileSync(file, 'utf-8');
    if (values.fix) {
      const fixed = ensureClosesLine(body, issue);
      if (fixed !== body) writeFileSync(file, fixed);
      body = fixed;
    }
    const result = validatePrBody(body, {issue, sections: (values.section as string[] | undefined) ?? []});
    console.log(values.json ? JSON.stringify(result) : result.ok ? 'pr body ok' : result.problems.join('\n'));
    if (!result.ok) process.exitCode = 1;
  },
};
