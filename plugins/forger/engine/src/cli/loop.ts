import {findHarness, guardRefusal} from '../adapters';
import {watchRepos} from './multi';
import {harnessOfRoot} from './harness-of';
import {hooksGateProblems, hooksGateRefusal} from '../checks';
import {spawnSync} from 'child_process';
import {relative} from 'path';
import {fastForwardRefusal, parseHaltClear, planBaseSync, readBaseSync, RESUME_FORMS, touchesPlugin} from '../loop';
import {detectLayout} from '../config';
import {gitignoreLines} from '../packs';
import {detachEngine, engineStartLine, readEngineStart} from './detach';
import type {Command} from './command';

/** The marker keeps the child from restarting itself again: one restart only. */
function restartSelf(): number {
  const child = spawnSync(process.argv[0], process.argv.slice(1), {stdio: 'inherit', env: {...process.env, FORGER_RESTARTED: '1'}});
  return child.status ?? 1;
}

export const run: Command = {
  name: 'run',
  needs: 'loop',
  flags: ['iterations', 'continuous', 'detach'],
  help: `  run [N]          Run N iterations (default: 1); first fast-forwards a base branch that is behind its remote
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
    const base = config.base_branch;
    const sync = readBaseSync(run(), base, gitignoreLines(detectLayout(projectRoot).dir));
    if (planBaseSync(sync, runner.statusReport().runner.alive) === 'fast-forward') {
      const before = ctx.capture()('git rev-parse HEAD').stdout.trim();
      const merged = ctx.capture()(`git merge --ff-only origin/${base}`);
      if (merged.exitCode !== 0) {
        console.error(`Not starting: ${fastForwardRefusal(base, merged.stderr || merged.stdout)}.`);
        process.exitCode = 1;
        return;
      }
      const changed = ctx.capture()(`git diff --name-only ${before} HEAD`).stdout;
      if (!values.detach && process.env.FORGER_RESTARTED !== '1' && touchesPlugin(changed, relative(projectRoot, pluginRoot))) {
        console.log(`${base} moved the plugin the engine runs from; starting again on the new code`);
        process.exitCode = (ctx.deps.restart ?? restartSelf)();
        return;
      }
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
  flags: ['cause', 'not-a-defect'],
  help: `  resume --cause <issue> | --not-a-defect "<why>"
                   Clear HALT and resume; the issue that fixes or tracks the cause, or why it was not a defect, is recorded with the failure`,
  run(ctx) {
    const {runner, values, config} = ctx;
    const parsed = parseHaltClear(values.cause, values['not-a-defect']);
    if (!parsed.ok) {
      console.error(`Not resuming: ${parsed.problem}. The halt stays. Give one of:\n  ${RESUME_FORMS}`);
      process.exitCode = 1;
      return;
    }
    const {cause} = parsed.why;
    if (cause !== null && config.tracker.kind === 'github' && ctx.capture()(`gh issue view ${cause} --json number`).exitCode !== 0) {
      console.error(`Not resuming: #${cause} is not an issue in the tracker. The halt stays. Give the issue that fixes or tracks the cause, or use --not-a-defect "<why>".`);
      process.exitCode = 1;
      return;
    }
    runner.clearHalt('halt_cleared', null, parsed.why);
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
