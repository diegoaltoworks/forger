import {linkBlockers} from '../backlog';
import type {Command} from './command';

export const linkBlockersCommand: Command = {
  name: 'link-blockers',
  needs: 'root',
  flags: ['json', 'issue'],
  help: `  link-blockers --issue N [--json]
                   Link every issue under the issue's "Blocked by" heading as a native
                   blocked-by, so a dependency written in prose is one the engine sees`,
  run({values, run}) {
    const issue = Number(values.issue);
    if (!Number.isInteger(issue) || issue <= 0) {
      console.error('link-blockers: --issue N is required');
      process.exitCode = 1;
      return;
    }
    try {
      const result = linkBlockers(run(), issue);
      console.log(
        values.json
          ? JSON.stringify(result)
          : `#${issue}: linked ${result.linked.map(n => `#${n}`).join(', ') || 'nothing'}; already linked ${result.already.map(n => `#${n}`).join(', ') || 'nothing'}`
      );
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    }
  },
};
