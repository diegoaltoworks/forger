import {readFileSync} from 'fs';

import {fileReplay, parseRequests, planReplay} from '../replay';
import type {Command} from './command';

export const replay: Command = {
  name: 'replay',
  needs: 'config',
  flags: ['json', 'file', 'dry-run'],
  help: `  replay --file requests.json [--dry-run] [--json]
                   File the stored owner requests as issues in this repository, in order, each with its
                   blocked-by set. Run it in a fresh copy of the sample repository. --dry-run prints the plan only`,
  run({values, config, run}) {
    const file = values.file as string | undefined;
    if (!file) {
      console.error('Usage: replay --file requests.json [--dry-run] [--json]');
      process.exitCode = 1;
      return;
    }
    try {
      const parsed = parseRequests(readFileSync(file, 'utf-8'));
      if (!parsed.ok) {
        console.error(`replay: ${file} is not a valid request set:\n${parsed.problems.map(p => `  ${p}`).join('\n')}`);
        process.exitCode = 1;
        return;
      }
      const plan = planReplay(parsed.requests);
      if (values['dry-run']) {
        console.log(values.json ? JSON.stringify(plan) : plan.map(p => `${p.position}. ${p.title}${p.blockedBy.length ? ` (after ${p.blockedBy.join(', ')})` : ''}`).join('\n'));
        return;
      }
      const filed = fileReplay(run(), plan, config.tracker.kind === 'github' ? config.tracker.label : null);
      console.log(values.json ? JSON.stringify(filed) : filed.map(f => `#${f.number} ${f.title}${f.blockedBy.length ? ` (blocked by ${f.blockedBy.map(n => `#${n}`).join(', ')})` : ''}`).join('\n'));
    } catch (e) {
      console.error(`replay: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  },
};
