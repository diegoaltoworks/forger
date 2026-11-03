import {join} from 'path';

import {awaitEvent, readEvents} from '../loop';
import type {Command} from './command';

export const events: Command = {
  name: 'events',
  needs: 'loop',
  flags: ['json'],
  help: '  events [--json]  Terminal events so far',
  run({values, projectRoot, config}) {
    const events = readEvents(join(projectRoot, config.paths.events));
    console.log(values.json ? JSON.stringify(events) : events.map(e => `${e.at} ${e.event}${e.ticket ? ` ${e.ticket}` : ''}${e.reason ? `: ${e.reason}` : ''}`).join('\n'));
  },
};

export const awaitEventCommand: Command = {
  name: 'await-event',
  needs: 'loop',
  flags: ['seen', 'timeout'],
  help: `  await-event [--seen N] [--timeout S]
                   Block until an event past the first N arrives (exit 2 on timeout)`,
  async run({values, projectRoot, config}) {
    const e = await awaitEvent(join(projectRoot, config.paths.events), parseInt(values.seen as string, 10), parseInt(values.timeout as string, 10) * 1000);
    if (!e) {
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify(e));
  },
};
