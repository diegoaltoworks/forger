/**
 * The per-iteration prompt handed to the headless worker. Pure: given the
 * config and the run state it produces a deterministic string, so a test can
 * assert it names the right worker command, base branch, gates and tracker.
 */

import type {WorkloopConfig} from './config';

export function buildPrompt(
  config: WorkloopConfig,
  iteration: number,
  completedTasks: string[]
): string {
  const completed = completedTasks.join(', ') || 'none';
  const trackerLine = {
    github: `- Tracker is GITHUB. Adopt open issues labelled \`${config.tracker.label}\` into backlog.json before selecting; claim the ticket's issue by assigning yourself; put \`Closes #<issue>\` in the PR body so the merge closes it. Never adopt \`wayfinder:*\` issues.`,
    local: `- Tracker is LOCAL. backlog.json is the only ticket record; do not create or update issues.`,
    none: `- Tracker is NONE. Do not create or update issues anywhere.`,
  }[config.tracker.kind];
  const gatesClause = config.gates ? ` (\`${config.gates}\`)` : '';

  return `Execute the /${config.worker_command} command. This is iteration ${iteration} of the automated workflow.

## Context
- Previous completed tasks: ${completed}
- Check ${config.paths.state} for full iteration history
- Follow .claude/process.md workflow strictly

## Requirements
1. Read the inbox for human instructions FIRST
2. Select and implement ONE ticket (deps completed, and not another repo's)
3. Run all quality gates${gatesClause}
4. Create ONE PR with ALL changes (code, tests, docs, backlog.json updates)
5. Squash merge onto ${config.base_branch}

## backlog.json is the source of truth for status
- Set the ticket \`status\` to "completed" in backlog.json when it is done.
${trackerLine}

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
