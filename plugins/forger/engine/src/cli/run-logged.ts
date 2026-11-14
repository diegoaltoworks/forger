import {spawnSync} from 'child_process';
import {appendFileSync} from 'fs';
import {relative} from 'path';

import {commandLine, keepOutput, loggedEnv, logLine} from '../loop';
import type {Command} from './command';

export const MAX_OUTPUT = 200_000;

export const runLogged: Command = {
  name: 'run-logged',
  needs: 'none',
  flags: ['file', 'root'],
  help: `  run-logged --file LOG [--root DIR] -- COMMAND...
                   Run a command in a shell, pass its output and exit code through, and append the
                   command, the folder it ran in (relative to DIR, default the current folder), its
                   exit code and its output to LOG (every test result line is kept; the rest is cut to a limit and the record says truncated); several arguments stay one argument each; the verifier's evidence is checked
                   against this log`,
  run(ctx) {
    const file = ctx.values.file as string | undefined;
    const command = commandLine(ctx.positionals.slice(1));
    if (!file || !command) {
      console.error('Usage: run-logged --file LOG [--root DIR] -- COMMAND...');
      process.exitCode = 1;
      return;
    }
    const root = (ctx.values.root as string | undefined) ?? process.cwd();
    const r = spawnSync('sh', ['-c', command], {encoding: 'utf-8', env: loggedEnv(process.env), maxBuffer: 256 * 1024 * 1024});
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    process.stdout.write(output);
    const exit = r.status ?? 1;
    appendFileSync(file, logLine({command, dir: relative(root, process.cwd()) || '.', exit, ...keepOutput(output, MAX_OUTPUT)}));
    process.exitCode = exit;
  },
};
