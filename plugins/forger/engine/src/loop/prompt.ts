/**
 * The per-iteration prompt handed to the headless worker. Pure: given the
 * config and the run state it produces a deterministic string, so a test can
 * assert it names the right worker command, base branch, gates and tracker.
 */

import type {WorkloopConfig} from '../config';

/**
 * How the worker reads and closes tickets. On GitHub the merge is the status
 * update, so the worker must not also write one into backlog.json.
 */
function backlogSection(config: WorkloopConfig): string {
  const {kind, label, ignore} = config.tracker;
  if (kind === 'github') {
    const lines = [
      '## GitHub Issues are the backlog',
      `- Tracker is GITHUB. Open issues labelled \`${label}\` are the tickets; ticket \`issue-<n>\` is issue #<n>. Branch as \`feat/issue-<n>\`.`,
      '- Priority and effort are labels (`P0`-`P3`, `effort:small|medium|large`); `depends_on` is the issue\'s native blocked-by; `needs-human` and `deferred` labels carry those statuses.',
      '- Claim the issue by assigning yourself; put `Closes #<issue>` in the PR body. Completed means closed by a merged PR, so do not edit backlog.json.',
    ];
    if (ignore.length > 0) {
      const labels = ignore.map(p => `\`${p}\``).join(', ');
      lines.push(`- Issues labelled ${labels} are not work; never take or adopt them.`);
    }
    return lines.join('\n');
  }
  return [
    '## backlog.json is the source of truth for status',
    '- Set the ticket `status` to "completed" in backlog.json when it is done.',
    kind === 'local'
      ? '- Tracker is LOCAL. backlog.json is the only ticket record; do not create or update issues.'
      : '- Tracker is NONE. Do not create or update issues anywhere.',
  ].join('\n');
}

/**
 * The engine owns the order (ADR 0008): the worker is told which ticket to
 * build and may decline it, never choose another.
 */
function pickClause(pick: string | null): string {
  if (pick === null) {
    return 'There is no workable ticket. Do not look for one: signal stop with the reason "no actionable tasks"';
  }
  return `Build ticket \`${pick}\` (the engine's pick) and no other. Read it, then build it or decline it: if it is blocked, too large or unclear, signal stop and say why`;
}

/**
 * A worker that shares the loop with others builds in its own worktree, on
 * a branch the engine made, and stays current with a command (ADR 0011).
 */
function worktreeSection(config: WorkloopConfig, pick: string): string {
  return [
    '## Your worktree',
    `- You are already in your own worktree, on the branch \`feat/${pick}\` made from ${config.base_branch}. Do not create or switch branches, and never touch another checkout.`,
    `- Before you push, and again before you merge if ${config.base_branch} moved, run \`bun plugins/forger/bin/work.ts rebase --ticket ${pick} --json\`. On \`conflict\` resolve it by hand, once, re-run the gates and push; if it still conflicts, stop and say so.`,
  ].join('\n');
}

/** The worker learns its deadline here and in FORGER_DEADLINE, so it can push before it is signalled. */
function deadlineLine(deadline: Date, graceSeconds: number): string {
  return `- Deadline: ${deadline.toISOString()} (also in the FORGER_DEADLINE environment variable). The engine signals you then and ends your process group ${graceSeconds}s later. Check it before any long wait, and push as soon as the gates are green.`;
}

export function buildPrompt(
  config: WorkloopConfig,
  iteration: number,
  completedTasks: string[],
  pick: string | null,
  inWorktree = false,
  deadline?: Date
): string {
  const completed = completedTasks.join(', ') || 'none';
  const gatesClause = config.gates ? ` (\`${config.gates}\`)` : '';
  const github = config.tracker.kind === 'github';
  const changes = github ? 'code, tests, docs' : 'code, tests, docs, backlog.json updates';

  return `Execute the /${config.worker_command} command. This is iteration ${iteration} of the automated workflow.

## Context
- Previous completed tasks: ${completed}
- Check ${config.paths.state} for full iteration history
- Follow ${config.paths.process} workflow strictly${deadline ? `\n${deadlineLine(deadline, config.limits.killGraceSeconds)}` : ''}

## Requirements
1. Read the inbox for human instructions FIRST
2. ${pickClause(pick)}
3. Run all quality gates${gatesClause}
4. Create ONE PR with ALL changes (${changes})
5. Squash merge onto ${config.base_branch}

${backlogSection(config)}
${inWorktree && pick ? `\n${worktreeSection(config, pick)}\n` : ''}
## IMPORTANT: Commit Rules
- Bundle EVERYTHING in one feat: PR (code + tests + docs + state updates)
- Do NOT create separate chore: or docs: commits

## Completion Signals

End your response with exactly one:

1. **<process>complete</process>** - work done successfully, continue to next iteration
2. **<process>stop</process>** - cannot proceed (blocked, no work, needs human input)

If you signal stop, explain WHY (e.g., "blocked: needs API keys", "no actionable tasks").
`;
}
