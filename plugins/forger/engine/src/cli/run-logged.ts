import {spawnSync} from 'child_process';
import {appendFileSync} from 'fs';

import {loggedEnv, logLine} from '../loop';
import type {Command} from './command';

const MAX_OUTPUT = 200_000;

export const runLogged: Command = {
  name: 'run-logged',
  needs: 'none',
  flags: ['file'],
  help: `  run-logged --file LOG -- COMMAND...
                   Run a command in a shell, pass its output and exit code through, and append the
                   command, its exit code and its output to LOG; the verifier's evidence is checked
                   against this log`,
  run(ctx) {
    const file = ctx.values.file as string | undefined;
    const command = ctx.positionals.slice(1).join(' ').trim();
    if (!file || !command) {
      console.error('Usage: run-logged --file LOG -- COMMAND...');
      process.exitCode = 1;
      return;
    }
    const r = spawnSync('sh', ['-c', command], {encoding: 'utf-8', env: loggedEnv(process.env), maxBuffer: 256 * 1024 * 1024});
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    process.stdout.write(output);
    const exit = r.status ?? 1;
    appendFileSync(file, logLine({command, exit, output: output.slice(-MAX_OUTPUT)}));
    process.exitCode = exit;
  },
};
