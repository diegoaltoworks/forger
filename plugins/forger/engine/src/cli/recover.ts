import {parseAllEvents, recover as recoverHalt, standingHalt} from '../loop';
import type {Command} from './command';
import {verifyOne} from './verify';

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export const recover: Command = {
  name: 'recover',
  needs: 'loop',
  flags: ['json'],
  help: `  recover [--json] Recover the standing halt when its recovery is known and checkable: an unverified merge is
                   verified, and a pass resumes the loop (a recovered event); a block or unclear keeps the HALT and
                   files a ticket for the revert. Any other halt stays, with the one recommended action`,
  async run(ctx) {
    const {values, runner, stateStore, config} = ctx;
    const halt = runner.statusReport().halted ? standingHalt(parseAllEvents(stateStore.readEvents())) : null;
    const result = await recoverHalt(halt, {
      async verify(pr) {
        const r = await verifyOne(ctx, pr);
        return {decision: r.decision, open: r.entries.filter(e => e.verdict !== 'met').map(e => `${e.criterion} ${e.verdict}`)};
      },
      fileTicket(title, body) {
        const label = config.tracker.kind === 'github' ? ` --label ${quote(config.tracker.label)}` : '';
        return ctx.run()(`gh issue create --title ${quote(title)} --body ${quote(body)}${label}`).trim();
      },
      resume: detail => runner.recoverHalt(detail),
    });
    console.log(values.json ? JSON.stringify(result) : result.detail);
    if (!result.recovered && result.kind !== 'none') process.exitCode = 1;
  },
};
