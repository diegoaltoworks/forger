/**
 * What the worker is told about its backlog, for each tracker kind. Pure; the
 * switches have no default so a new kind must be answered here.
 */

import type {WorkloopConfig} from '../config';

type Kinded = Pick<WorkloopConfig, 'tracker'>;

/**
 * How the worker reads and closes tickets. On GitHub the merge is the status
 * update, so the worker must not also write one into backlog.json.
 */
export function workerBacklogText(config: Kinded): string {
  const {kind, label, ignore} = config.tracker;
  switch (kind) {
    case 'github': {
      const lines = [
        '## GitHub Issues are the backlog',
        `- Tracker is GITHUB. Open issues labelled \`${label}\` are the tickets; ticket \`issue-<n>\` is issue #<n>. Branch as \`feat/issue-<n>\`.`,
        '- Priority and effort are labels (`P0`-`P3`, `effort:small|medium|large`); `depends_on` is the issue\'s native blocked-by; `needs-human` and `deferred` labels carry those statuses.',
        '- Claim the issue by assigning yourself; put `Closes #<issue>` in the PR body. Completed means closed by a merged PR, so do not edit backlog.json.',
        '- The issue\'s `## Decisions` entries are the owner\'s answers and override the ticket\'s earlier text where the two disagree.',
      ];
      if (ignore.length > 0) {
        const labels = ignore.map(p => `\`${p}\``).join(', ');
        lines.push(`- Issues labelled ${labels} are not work; never take or adopt them.`);
      }
      return lines.join('\n');
    }
    case 'jira':
      return [
        '## A Jira project is the backlog',
        `- Tracker is JIRA. The issue \`KEY-<n>\` is the ticket \`issue-<n>\`. Branch as \`feat/issue-<n>\`.`,
        '- Never call Jira yourself; the engine reads and updates the issues.',
        '- The pull request holds code, tests and docs.',
      ].join('\n');
    case 'local':
      return fileText('- Tracker is LOCAL. backlog.json is the only ticket record; do not create or update issues.');
    case 'none':
      return fileText('- Tracker is NONE. Do not create or update issues anywhere.');
  }
}

function fileText(trackerLine: string): string {
  return ['## backlog.json is the source of truth for status', '- Set the ticket `status` to "completed" in backlog.json when it is done.', trackerLine].join('\n');
}

/** What the worker's one pull request holds. */
export function workerChangesText(config: Kinded): string {
  switch (config.tracker.kind) {
    case 'github':
    case 'jira':
      return 'code, tests, docs';
    case 'local':
    case 'none':
      return 'code, tests, docs, backlog.json updates';
  }
}
