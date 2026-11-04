import {join} from 'path';

import {handedOver, handOver, issueNumber, nextMove, openLabel, parseCriteria, readAllVerdicts, readVerdicts} from '../loop';
import type {Command} from './command';

export const handover: Command = {
  name: 'handover',
  needs: 'config',
  flags: ['json', 'pr', 'list'],
  help: `  handover --pr N [--json] | handover --list [--json]
                   After a verify that did not pass: say the next move (fix and verify again while
                   rounds remain, then label the issue needs-human and comment the criteria at fault;
                   exit 1 on a hand-over). --list reports the tickets handed over`,
  run(ctx) {
    const {values, config, projectRoot} = ctx;
    const dir = join(projectRoot, config.paths.verdicts);
    const max = config.limits.maxVerifyRounds;
    const json = !!values.json;

    if (values.list) {
      const list = handedOver(readAllVerdicts(dir), max);
      console.log(
        json
          ? JSON.stringify(list)
          : list.length === 0
            ? 'No tickets handed over.'
            : list.map(h => `${h.ticket} (PR #${h.pr}, ${h.rounds} rounds): ${h.open.map(openLabel).join(', ')}`).join('\n')
      );
      return;
    }

    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    if (Number.isNaN(pr)) {
      console.error('Usage: handover --pr N [--json] | handover --list [--json]');
      process.exitCode = 1;
      return;
    }
    const records = readVerdicts(dir, pr);
    const move = nextMove(records, max);
    let handed: string | null = null;
    if (move.move === 'hand_over') {
      try {
        const h = handedOver(records, max)[0];
        const texts: Record<string, string> = {};
        const issue = issueNumber(h.ticket);
        if (config.tracker.kind === 'github' && issue !== null) {
          for (const c of parseCriteria(ctx.run()(`gh issue view ${issue} --json body --jq .body`))) texts[c.id] = c.text;
        }
        handed = handOver(ctx.run(), h, texts, config.tracker.label);
      } catch (e) {
        console.error(`handover: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
      process.exitCode = 1;
    }
    console.log(json ? JSON.stringify({pr, ...move, handed_over: handed}) : handed ? `PR #${pr}: ${handed}` : `PR #${pr}: ${move.move}`);
  },
};
