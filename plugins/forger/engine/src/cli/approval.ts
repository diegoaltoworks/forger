import {approvalFor} from '../supervisor';
import type {Command} from './command';

export const approval: Command = {
  name: 'approval',
  needs: 'none',
  flags: [],
  help: '  approval ACTION  Who may do ACTION: alone, alone_and_report, owner or never',
  run({positionals}) {
    console.log(approvalFor(positionals[1] ?? ''));
  },
};
