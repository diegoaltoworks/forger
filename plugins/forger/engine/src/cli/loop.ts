import {findHarness, guardRefusal} from '../adapters';
import {watchRepos} from './multi';
import {harnessOfRoot} from './harness-of';
import {hooksGateProblems, hooksGateRefusal} from '../checks';
import {behindBaseRefusal, readBaseSync} from '../loop';
import {detachEngine, engineStartLine, readEngineStart} from './detach';
import type {Command} from './command';

export const run: Command = {
  name: 'run',
  needs: 'loop',
  flags: ['iterations', 'continuous', 'detach'],
  help: `  run [N]          Run N iterations (default: 1)
  run --continuous Run until all tasks complete
  run --continuous --detach
                   Start the engine so it outlives this session: a container with a restart policy under the docker sandbox, else a new session`,
  async run(ctx) {
    const {values, positionals, runner, run, config, projectRoot, pluginRoot} = ctx;
    const unguarded = guardRefusal(findHarness(config.harness), config.allow_unguarded);
    if (unguarded) {
      console.error(`Not starting: ${unguarded}.`);
      process.exitCode = 1;
      return;
    }
    const hooks = hooksGateRefusal(hooksGateProblems(projectRoot, pluginRoot, harnessOfRoot(projectRoot)));
    if (hooks) {
      console.error(`Not starting: ${hooks}.`);
      process.exitCode = 1;
      return;
    }
    const stale = behindBaseRefusal(readBaseSync(run(), config.base_branch), config.base_branch);
    if (stale) {
      console.error(`Not starting: ${stale}.`);
      process.exitCode = 1;
      return;
    }
    if (values.detach) {
      detachEngine(ctx);
      return;
    }
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
  flags: ['json', 'from'],
  help: '  status [--json] [--from local|branch] Show current status, runner pid and liveness; --from branch reads the state branch of a clone',
  run(ctx) {
    const {values, runner} = ctx;
    if (values.json) console.log(JSON.stringify({...runner.statusReport(), engine_start: readEngineStart(ctx)}));
    else {
      runner.showStatus();
      console.log(engineStartLine(ctx));
    }
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
  needs: 'none',
  flags: ['repos', 'timeout'],
  help: `  watch [--repos PATH,PATH] [--timeout S]
                   Live status display; with --repos, follow every loop's events (terminal and mid-run) as one JSON line each, tagged with its repository`,
  async run(ctx) {
    if (ctx.values.repos === undefined) {
      await ctx.runner.watch();
      return;
    }
    await watchRepos(ctx);
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
