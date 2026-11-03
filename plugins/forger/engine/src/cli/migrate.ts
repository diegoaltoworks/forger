import {gitStateStore} from '../adapters';
import {loadConfig} from '../config';
import {formatMigrate, formatMigrateState, MigrateRefused, runMigrate, runMigrateState} from '../migrate';
import type {Command} from './command';

export const migrate: Command = {
  name: 'migrate',
  needs: 'root',
  flags: ['json', 'state'],
  help: `  migrate [--json] Move forger's files from the legacy layout to .forger/
                   (git mv where tracked; refuses while an engine holds the lock; safe to repeat)
  migrate --state [--json]
                   Move the state record and events to the state branch, split by day, and set
                   state.home (refuses while an engine lock or live lease exists; local files stay)`,
  run(ctx) {
    try {
      if (ctx.values.state) {
        const result = runMigrateState({projectRoot: ctx.projectRoot, branch: gitStateStore({repo: ctx.projectRoot})});
        console.log(ctx.values.json ? JSON.stringify(result) : formatMigrateState(result));
        return;
      }
      const lock = loadConfig(ctx.projectRoot).paths.lock;
      const result = runMigrate(ctx.projectRoot, ctx.run(), lock);
      console.log(ctx.values.json ? JSON.stringify(result) : formatMigrate(result));
    } catch (e) {
      if (!(e instanceof MigrateRefused)) throw e;
      console.error(e.message);
      process.exitCode = 1;
    }
  },
};
