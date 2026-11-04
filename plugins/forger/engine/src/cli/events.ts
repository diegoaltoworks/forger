import {awaitEvent, parseWatchedEvents} from '../loop';
import type {Command} from './command';

export const events: Command = {
  name: 'events',
  needs: 'loop',
  flags: ['json'],
  help: '  events [--json]  Terminal and mid-run (worker_denied) events so far',
  run({values, stateStore}) {
    const events = parseWatchedEvents(stateStore.readEvents());
    console.log(values.json ? JSON.stringify(events) : events.map(e => `${e.at} ${e.event}${e.ticket ? ` ${e.ticket}` : ''}${e.reason ? `: ${e.reason}` : ''}`).join('\n'));
  },
};

export const awaitEventCommand: Command = {
  name: 'await-event',
  needs: 'loop',
  flags: ['seen', 'timeout'],
  help: `  await-event [--seen N] [--timeout S]
                   Block until an event past the first N arrives (exit 2 on timeout)`,
  async run({values, stateStore, config}) {
    // A read of the state branch is a fetch, so it is polled far less often than a local file.
    const pollMs = config.state.home === 'branch' ? 15_000 : 1000;
    const e = await awaitEvent(
      () => parseWatchedEvents(stateStore.readEvents()),
      parseInt(values.seen as string, 10),
      parseInt(values.timeout as string, 10) * 1000,
      undefined,
      pollMs
    );
    if (!e) {
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify(e));
  },
};
