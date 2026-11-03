import {SpecOutputError} from '../ports';
import type {Command} from './command';
import {specProvider} from './spec-provider';

export const slice: Command = {
  name: 'slice',
  needs: 'root',
  flags: ['json'],
  help: `  slice <ID...> [--json]
                   Print the spec slice of each requirement ID a ticket's Satisfies: line names
                   (exit 2 when no spec provider is installed, 1 when an ID cannot be read)`,
  run(ctx) {
    const ids = ctx.positionals.slice(1);
    if (ids.length === 0) {
      console.error('Usage: slice <ID...> [--json]');
      process.exitCode = 1;
      return;
    }
    const provider = specProvider(ctx);
    const slices: Array<{id: string; slice: string | null; error?: string}> = [];
    for (const id of ids) {
      try {
        slices.push({id, slice: provider.slice(id)});
      } catch (e) {
        if (!(e instanceof SpecOutputError)) throw e;
        slices.push({id, slice: null, error: e.message});
      }
    }
    if (ctx.values.json) console.log(JSON.stringify(slices));
    else console.log(slices.map(s => (s.slice === null ? `${s.id}: ${s.error ?? 'no spec provider is installed'}` : s.slice)).join('\n'));
    if (slices.some(s => s.error !== undefined)) process.exitCode = 1;
    else if (slices.some(s => s.slice === null)) process.exitCode = 2;
  },
};
