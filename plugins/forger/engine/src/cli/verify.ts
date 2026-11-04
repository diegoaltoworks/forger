import {join} from 'path';
import {randomUUID} from 'crypto';

import {agentFor, findHarness, slcrProvider} from '../adapters';
import {resolveModel} from '../config';
import {setupCommand, verdictsHome, verifierTier, verifyPr, type VerifyResult} from '../loop';
import type {Command, CommandContext} from './command';

/** Verifies one PR's head with the project's verifier; shared by `verify` and `recover`. */
export function verifyOne(ctx: CommandContext, pr: number): Promise<VerifyResult> {
  const {config, projectRoot} = ctx;
  const tier = verifierTier(config);
  return verifyPr(ctx.run(), ctx.deps.agent ?? agentFor(findHarness(config.harness)), {
    pr,
    trackerKind: config.tracker.kind,
    backlogFile: join(projectRoot, config.paths.backlog),
    verdictsDir: verdictsHome(ctx.run(), projectRoot, config.paths.verdicts),
    tier,
    setup: setupCommand(config.verify.setup, config.gates),
    model: resolveModel(tier.model, config.models),
    verifierCommand: 'forger:verify',
    timeoutMinutes: config.limits.timeoutMinutes,
    killGraceSeconds: config.limits.killGraceSeconds,
    sessionId: randomUUID(),
    runLogged: `bun ${join(ctx.pluginRoot, 'bin', 'work.ts')} run-logged`,
    capture: ctx.capture(),
    specReport: dir => slcrProvider({projectRoot: dir, baseBranch: config.base_branch}).report('head'),
  });
}

export const verify: Command = {
  name: 'verify',
  needs: 'config',
  flags: ['json', 'pr'],
  help: `  verify --pr N [--json]
                   Run a fresh-context verifier on the PR's head (the ticket's criteria, the diff and
                   the gate result, never the worker's claims) and record its verdict per criterion
                   (exit 1 unless every criterion is met); on GitHub it also sets the forger/verify
                   status on the head: success for a pass, failure otherwise`,
  async run(ctx) {
    const {values} = ctx;
    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    if (Number.isNaN(pr)) {
      console.error('Usage: verify --pr N [--json]');
      process.exitCode = 1;
      return;
    }
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
