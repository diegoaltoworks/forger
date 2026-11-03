import {formatBacklogReport} from '../backlog';
import type {Command} from './command';

export const backlog: Command = {
  name: 'backlog',
  needs: 'loop',
  flags: ['json'],
  help: '  backlog [--json] Workable tickets in order, remaining count and next pick',
  run({values, backlog}) {
    const report = backlog.report();
    console.log(values.json ? JSON.stringify(report) : formatBacklogReport(report));
  },
};
