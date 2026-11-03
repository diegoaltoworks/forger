import type {Command} from './command';

export const run: Command = {
  name: 'run',
  needs: 'loop',
  flags: ['iterations', 'continuous'],
  help: `  run [N]          Run N iterations (default: 1)
  run --continuous Run until all tasks complete`,
  async run({values, positionals, runner}) {
    const iterationArg = positionals[1] || (values.iterations as string);
    const started = await runner.run(parseInt(iterationArg, 10), values.continuous as boolean);
    if (!started) {
      console.error('Another runner is already running; not starting a second one.');
      process.exitCode = 1;
    }
  },
};

export const status: Command = {
  name: 'status',
  needs: 'loop',
  flags: ['json'],
  help: '  status [--json] Show current status, runner pid and liveness',
  run({values, runner}) {
    if (values.json) console.log(JSON.stringify(runner.statusReport()));
    else runner.showStatus();
  },
};

export const reset: Command = {
  name: 'reset',
  needs: 'loop',
  flags: [],
  help: '  reset            Reset state to start fresh',
  run({runner}) {
    runner.resetState();
  },
};

export const watch: Command = {
  name: 'watch',
  needs: 'loop',
  flags: [],
  help: '  watch            Live status display',
  async run({runner}) {
    await runner.watch();
  },
};

export const resume: Command = {
  name: 'resume',
  needs: 'loop',
  flags: [],
  help: '  resume           Clear HALT and resume',
  run({runner}) {
    runner.clearHalt();
    console.log('Halt cleared. You can now run automation again.');
    runner.showStatus();
  },
};

export const halt: Command = {
  name: 'halt',
  needs: 'loop',
  flags: [],
  help: '  halt [reason]    Manually halt automation',
  run({positionals, runner}) {
    runner.halt(positionals[1] || 'Manual halt');
  },
};
