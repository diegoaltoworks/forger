import {join} from 'path';

import {DECLINE_REASONS, validateDecline, writeDeclineRecord, leaveQueue} from '../loop';
import type {Command} from './command';

export const decline: Command = {
  name: 'decline',
  needs: 'config',
  flags: ['json', 'ticket', 'reason', 'detail'],
  help: `  decline --ticket ID --reason ${DECLINE_REASONS.join('|')} --detail TEXT [--json]
                   Record that the engine's pick cannot be built and take it out of the queue
                   (GitHub: swap the intake label for needs-info and comment the detail);
                   the engine reads the record, and halts after repeated declines`,
  run(ctx) {
    const {values, config, projectRoot} = ctx;
    const check = validateDecline({
      ticket: values.ticket as string | undefined,
      reason: values.reason as string | undefined,
      detail: values.detail as string | undefined,
    });
    if (!check.ok) {
      console.error(`decline: ${check.error}`);
      process.exitCode = 1;
      return;
    }
    const record = {ticket: check.ticket, reason: check.reason, detail: check.detail, at: new Date().toISOString()};
    let done: string;
    try {
      done = leaveQueue(
        ctx.run(),
        {trackerKind: config.tracker.kind, intakeLabel: config.tracker.label, backlogFile: join(projectRoot, config.paths.backlog)},
        record
      );
    } catch (e) {
      console.error(`decline: ${(e as Error).message}`);
      process.exitCode = 1;
      return;
    }
    writeDeclineRecord(join(projectRoot, config.paths.declined), record);
    console.log(values.json ? JSON.stringify({declined: record, queue: done}) : `Declined ${record.ticket} (${record.reason}): ${done}`);
  },
};
