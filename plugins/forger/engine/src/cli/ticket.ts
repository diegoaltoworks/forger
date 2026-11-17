import {ticketMarkdown} from '../tracker';
import type {Command} from './command';

export const ticket: Command = {
  name: 'ticket',
  needs: 'config',
  flags: ['json'],
  help: `  ticket <n> [--json]
                   Print a ticket's title, labels and text as markdown, through the configured tracker, for every kind;
                   --json gives the same as data. A ticket that does not exist exits 1 with one line`,
  run(ctx) {
    const raw = ctx.positionals[1] ?? '';
    if (!/^#?\d+$/.test(raw)) {
      console.error('ticket: usage: ticket <n> [--json]');
      process.exitCode = 1;
      return;
    }
    const n = parseInt(raw.replace(/^#/, ''), 10);
    const tracker = ctx.tracker();
    try {
      if (!tracker.exists(n)) throw new Error('no such ticket');
      const {labels, body} = tracker.facts(n);
      const view = {ticket: n, title: tracker.title(n), labels, body};
      console.log(ctx.values.json ? JSON.stringify(view) : ticketMarkdown(view));
    } catch {
      console.error(`ticket: ticket ${n} does not exist`);
      process.exitCode = 1;
    }
  },
};
