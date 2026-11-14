import {join} from 'path';
import {randomUUID} from 'crypto';

import {agentFor, execCapture, findHarness, sandboxFor, sandboxSite, slcrProvider} from '../adapters';
import {resolveModel} from '../config';
import {engineChangedMessage, engineChanges, eventLine, flakyReason, loopRootOf, terminalEvent, ticketFlaky, verdictsHome, verifierTier, verifyPr, workerIdentity, type VerifyResult} from '../loop';
import type {Command, CommandContext} from './command';

/**
 * Refuses a decision made from an engine whose source has uncommitted changes:
 * sets exit 1, records `engine_changed` and says so. True when it refused.
 */
export function refuseChangedEngine(ctx: CommandContext, command: 'verify' | 'merge'): boolean {
  const paths = engineChanges(ctx.run(), ctx.pluginRoot);
  if (paths.length === 0) return false;
  const worker = workerIdentity(process.env);
  try {
    ctx.stateStore.appendEvent(eventLine(terminalEvent('engine_changed', worker?.iteration ?? 0, worker?.ticket ?? null, `${command}: ${paths.join(', ')}`)), new Date());
  } catch (e) {
    console.error(`${command}: the refusal was not recorded: ${(e as Error).message}`);
  }
  process.exitCode = 1;
  const message = engineChangedMessage(command, paths);
  if (ctx.values.json) console.log(JSON.stringify({refused: 'engine_changed', paths, reason: message}));
  else console.error(message);
  return true;
}

/** Verifies one PR's head with the project's verifier; shared by `verify` and `recover`. */
export function verifyOne(ctx: CommandContext, pr: number): Promise<VerifyResult> {
  const {config, projectRoot} = ctx;
  const tier = verifierTier(config);
  return verifyPr(ctx.run(), ctx.deps.agent ?? agentFor(findHarness(config.harness), config.model_prices, sandboxFor(config.sandbox, execCapture(projectRoot), sandboxSite(config, projectRoot, ctx.pluginRoot))), {
    pr,
    trackerKind: config.tracker.kind,
    backlogFile: join(projectRoot, config.paths.backlog),
    verdictsDir: verdictsHome(ctx.run(), projectRoot, config.paths.verdicts),
    tmpDir: join(loopRootOf(ctx.run(), projectRoot), config.paths.tmp),
    tier,
    setup: config.verify.setup,
    model: resolveModel(tier.model, config.models),
    verifierCommand: 'forger:verify',
    timeoutMinutes: config.limits.timeoutMinutes,
    killGraceSeconds: config.limits.killGraceSeconds,
    gates: config.gates,
    onFlaky: flaky => {
      ctx.stateStore.appendEvent(eventLine(terminalEvent('flaky_gate', 0, null, flakyReason(flaky))), new Date());
      if (config.tracker.kind === 'github') ticketFlaky(ctx.run(), flaky, config.tracker.label);
    },
    checksTimeoutMs: parseInt(ctx.values.timeout as string, 10) * 1000,
    sessionId: randomUUID(),
    runLogged: `bun ${join(ctx.pluginRoot, 'bin', 'work.ts')} run-logged`,
    warn: message => console.error(message),
    capture: ctx.capture(),
    specReport: dir => slcrProvider({projectRoot: dir, baseBranch: config.base_branch}).report('head'),
  });
}

export const verify: Command = {
  name: 'verify',
  needs: 'config',
  flags: ['json', 'pr', 'timeout'],
  help: `  verify --pr N [--json] [--timeout S]
                   Run a fresh-context verifier on the PR's head (the ticket's criteria, the diff and
                   the gate result, never the worker's claims) and record its verdict per criterion
                   (exit 1 unless every criterion is met); on GitHub it also sets the forger/verify
                   status on the head: success for a pass, failure otherwise. "Gates green" is decided
                   from the head's CI checks, waiting up to the timeout for unfinished ones. A verdict that is not a pass
                   keeps the copy's command log beside the verdict record (commandLog in the JSON).
                   Refuses (exit 1, no verdict, no status) when the engine's own source has uncommitted changes`,
  async run(ctx) {
    const {values} = ctx;
    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    if (Number.isNaN(pr)) {
      console.error('Usage: verify --pr N [--json] [--timeout S]');
      process.exitCode = 1;
      return;
    }
    if (refuseChangedEngine(ctx, 'verify')) return;
    try {
      const record = await verifyOne(ctx, pr);
      if (record.decision !== 'pass') process.exitCode = 1;
      if (record.status?.error) console.error(`verify: the verdict is recorded but the ${record.status.context} status was not set: ${record.status.error}`);
      console.log(
        values.json
          ? JSON.stringify(record)
          : `PR #${record.pr} at ${record.head.slice(0, 7)}: ${record.decision}${record.status && !record.status.error ? ` (${record.status.context}: ${record.status.state})` : ''}\n${record.entries.map(e => `  ${e.criterion}: ${e.verdict}`).join('\n')}`
      );
    } catch (e) {
      console.error(`verify: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  },
};
