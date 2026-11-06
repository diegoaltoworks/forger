import {existsSync, readFileSync} from 'fs';
import {dirname, join} from 'path';
import {randomUUID} from 'crypto';

import {agentFor, execCapture, findHarness, sandboxFor} from '../adapters';
import {resolveModel, forgerPath} from '../config';
import {critiquePr, DEFAULT_THRESHOLD, isSeverity, type CritiqueResult} from '../critique';
import {loopRootOf, verdictsHome, verifierTier} from '../loop';
import {CRITIQUE_SEVERITIES} from '../pipeline';
import {parseUiConfig, UI_PATH} from '../ui';
import type {Command, CommandContext} from './command';

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function visualPaths(ctx: CommandContext): string[] {
  const path = forgerPath(ctx.projectRoot, UI_PATH);
  return existsSync(path) ? parseUiConfig(readFileSync(path, 'utf-8')).paths : [];
}

function format(r: CritiqueResult): string {
  if (r.status === 'skipped') return `PR #${r.pr}: no critique, ${r.reason}`;
  if (r.status === 'invalid') return `PR #${r.pr}: the critic's answer broke its contract twice:\n${r.problems.map(p => `  ${p}`).join('\n')}`;
  return [
    `PR #${r.pr} at ${r.head.slice(0, 7)}: critiqued`,
    ...r.dimensions.map(d => `  ${d.name}: ${d.score}/5 - ${d.reason}`),
    ...r.filed.map(f => `  filed ${f.ticket} (${f.severity}, ${f.dimension}): ${f.title}`),
    ...r.reported.map(f => `  reported (${f.severity}, ${f.dimension}): ${f.title}`),
  ].join('\n');
}

export const critique: Command = {
  name: 'critique',
  needs: 'config',
  flags: ['json', 'pr', 'threshold', 'force'],
  help: `  critique --pr N [--threshold high|medium|low] [--force] [--json]
                   After a change the audience sees (a ui path or a capture in the diff; --force skips that test),
                   run a fresh-context critic on the PR's head against the verbatim brief in the plan doc and the
                   captures. It scores feel, readability, feedback and fidelity, and files each finding at or above
                   the threshold (default ${DEFAULT_THRESHOLD}) as a ticket; the rest are reported. Never blocks a merge`,
  async run(ctx) {
    const {values, config, projectRoot} = ctx;
    const pr = parseInt((values.pr as string | undefined) ?? '', 10);
    const threshold = (values.threshold as string | undefined) ?? DEFAULT_THRESHOLD;
    if (Number.isNaN(pr) || !isSeverity(threshold)) {
      console.error(`Usage: critique --pr N [--threshold ${CRITIQUE_SEVERITIES.join('|')}] [--force] [--json]`);
      process.exitCode = 1;
      return;
    }
    try {
      const tier = verifierTier(config);
      const label = config.tracker.kind === 'github' ? ` --label ${quote(config.tracker.label)}` : '';
      const result = await critiquePr(
        ctx.run(),
        ctx.deps.agent ?? agentFor(findHarness(config.harness), config.model_prices, sandboxFor(config.sandbox, execCapture(ctx.projectRoot))),
        {fileTicket: (title, body) => ctx.run()(`gh issue create --title ${quote(title)} --body ${quote(body)}${label}`).trim()},
        {
          pr,
          force: Boolean(values.force),
          threshold,
          visualPaths: visualPaths(ctx),
          recordsDir: join(dirname(verdictsHome(ctx.run(), projectRoot, config.paths.verdicts)), 'critiques'),
          tmpDir: join(loopRootOf(ctx.run(), projectRoot), config.paths.tmp),
          tier,
          model: resolveModel(tier.model, config.models),
          critiqueCommand: 'forger:critique',
          timeoutMinutes: config.limits.timeoutMinutes,
          killGraceSeconds: config.limits.killGraceSeconds,
          sessionId: randomUUID(),
        }
      );
      if (result.status === 'invalid') process.exitCode = 1;
      console.log(values.json ? JSON.stringify(result) : format(result));
    } catch (e) {
      console.error(`critique: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  },
};
