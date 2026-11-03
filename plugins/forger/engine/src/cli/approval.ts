import {join} from 'path';

import {appendEvent, terminalEvent} from '../loop';
import {approvalFor} from '../supervisor';
import type {Command, CommandContext} from './command';

export const approval: Command = {
  name: 'approval',
  needs: 'none',
  flags: [],
  help: '  approval ACTION  Who may do ACTION: alone, alone_and_report, owner or never (logged as an event inside a project)',
  run(ctx) {
    const action = ctx.positionals[1] ?? '';
    const authority = approvalFor(action);
    record(ctx, action, authority);
    console.log(authority);
  },
};

/** Best effort: the answer must still come out away from a project, where there is no log. */
function record(ctx: CommandContext, action: string, authority: string): void {
  try {
    appendEvent(join(ctx.projectRoot, ctx.config.paths.events), terminalEvent('approval_asked', 0, null, `${action}: ${authority}`));
  } catch {
    // No project, no event file.
  }
}
