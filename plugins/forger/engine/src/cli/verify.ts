import {join} from 'path';
import {randomUUID} from 'crypto';

import {agentFor, findHarness, slcrProvider} from '../adapters';
import {resolveModel} from '../config';
import {verifierTier, verifyPr} from '../loop';
import type {Command} from './command';

export const verify: Command = {
  name: 'verify',
  needs: 'config',
  flags: ['json', 'pr'],
  help: `  verify --pr N [--json]
                   Run a fresh-context verifier on the PR's head (the ticket's criteria, the diff and
                   the gate result, never the worker's claims) and record its verdict per criterion
                   (exit 1 unless every criterion is met)`,
  async run(ctx) {
    const {values, config, projectRoot} = ctx;
    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    if (Number.isNaN(pr)) {
      console.error('Usage: verify --pr N [--json]');
      process.exitCode = 1;
      return;
    }
    const tier = verifierTier(config);
    try {
      const record = await verifyPr(ctx.run(), ctx.deps.agent ?? agentFor(findHarness(config.harness)), {
        pr,
        trackerKind: config.tracker.kind,
        backlogFile: join(projectRoot, config.paths.backlog),
        verdictsDir: join(projectRoot, config.paths.verdicts),
        tier,
        model: resolveModel(tier.model, config.models),
        verifierCommand: 'forger:verify',
        timeoutMinutes: config.limits.timeoutMinutes,
        killGraceSeconds: config.limits.killGraceSeconds,
        sessionId: randomUUID(),
        specReport: dir => slcrProvider({projectRoot: dir, baseBranch: config.base_branch}).report('head'),
      });
      if (record.decision !== 'pass') process.exitCode = 1;
      console.log(
        values.json
          ? JSON.stringify(record)
          : `PR #${record.pr} at ${record.head.slice(0, 7)}: ${record.decision}\n${record.entries.map(e => `  ${e.criterion}: ${e.verdict}`).join('\n')}`
      );
    } catch (e) {
      console.error(`verify: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  },
};
