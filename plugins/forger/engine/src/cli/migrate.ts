import {loadConfig} from '../config';
import {formatMigrate, MigrateRefused, runMigrate} from '../migrate';
import type {Command} from './command';

export const migrate: Command = {
  name: 'migrate',
  needs: 'root',
  flags: ['json'],
  help: `  migrate [--json] Move forger's files from the legacy layout to .forger/
                   (git mv where tracked; refuses while an engine holds the lock; safe to repeat)`,
  run(ctx) {
    try {
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
