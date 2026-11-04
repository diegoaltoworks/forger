import {existsSync, readFileSync} from 'fs';

import {parseFootprint} from '../backlog';
import {forgerPath} from '../config';
import {LOCK_PATH, loadPresets, parseLock} from '../packs';
import {loadDefinition, loadOverlay, NO_TICKET, resolvePipeline, type PipelinePlan, type TicketFacts} from '../pipeline';
import type {Command, CommandContext} from './command';

function ticketFacts(ctx: CommandContext, issue: number): TicketFacts {
  const out = ctx.run()(`gh issue view ${issue} --json labels,body`);
  const data = JSON.parse(out) as {labels?: Array<{name: string}>; body?: string};
  return {
    id: `issue-${issue}`,
    labels: (data.labels ?? []).map(l => l.name),
    paths: parseFootprint(data.body ?? '')?.paths ?? [],
    packs: [],
  };
}

function installedPacks(ctx: CommandContext): string[] {
  const lock = forgerPath(ctx.projectRoot, LOCK_PATH);
  return existsSync(lock) ? parseLock(readFileSync(lock, 'utf-8')).packs.map(p => p.id) : [];
}

export function formatPlan(plan: PipelinePlan): string {
  const lines: string[] = [];
  for (const s of plan.stages) {
    lines.push(`${s.id} (${s.command}) -> gate: ${s.gate}`);
    for (const slot of s.slots) lines.push(`  ${slot.slot}${slot.on ? ` on ${slot.on}` : ''}: ${slot.invoke} ${slot.target ?? '-'} (${slot.reason})`);
    for (const k of s.skipped) lines.push(`  ${k.slot}: skipped (${k.reason})`);
  }
  if (plan.disabled.length > 0) lines.push(`disabled: ${plan.disabled.join(', ')}`);
  for (const p of plan.problems) lines.push(`! ${p}`);
  return lines.join('\n');
}

export const pipeline: Command = {
  name: 'pipeline',
  needs: 'config',
  flags: ['json', 'issue', 'stage'],
  help: `  pipeline [--issue N] [--stage ID] [--json]
                   Resolve the pipeline for a ticket: each stage, the slots it runs, the skill,
                   file or built-in step chosen for each and why, and the gate after it;
                   without --issue the ticket has no labels and no paths`,
  run(ctx) {
    const {values, config, pluginRoot, projectRoot} = ctx;
    try {
      const issueArg = values.issue as string | undefined;
      const issue = issueArg === undefined ? null : Number(issueArg);
      if (issue !== null && !Number.isInteger(issue)) throw new Error(`--issue must be an issue number, got "${issueArg}"`);
      const ticket = issue === null ? {...NO_TICKET, packs: installedPacks(ctx)} : {...ticketFacts(ctx, issue), packs: installedPacks(ctx)};
      const plan = resolvePipeline(loadDefinition(pluginRoot), loadOverlay(forgerPath(projectRoot, '.forger')), config.skills, ctx.installedSkills(), ticket, {
        roots: [...ctx.collectionRoots(), pluginRoot],
        presets: loadPresets(pluginRoot),
      });
      const stage = values.stage as string | undefined;
      if (stage !== undefined) {
        if (!plan.stages.some(s => s.id === stage)) throw new Error(`no stage "${stage}" in the pipeline: ${plan.stages.map(s => s.id).join(', ')}`);
        plan.stages = plan.stages.filter(s => s.id === stage);
      }
      console.log(values.json ? JSON.stringify(plan) : formatPlan(plan));
      if (plan.problems.length > 0) process.exitCode = 1;
    } catch (e) {
      console.error(`pipeline: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  },
};
