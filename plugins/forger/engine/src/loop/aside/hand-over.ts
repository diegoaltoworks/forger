/**
 * Setting a ticket aside on the tracker: the `needs-human` label and the
 * reason as a comment. A ticket `handover` already labelled and commented is
 * not commented again. Every tracker call goes through the injected runner;
 * a failure is returned, not thrown, since the ticket is set aside either way.
 */

import type {CommandRunner} from '../../ports';
import {listIssueLabels} from '../labels';
import {NEEDS_HUMAN_LABEL} from '../handover-io';

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Labels the issue and posts `comment` unless it was labelled before (`always` posts regardless); the problems met. */
export function setAsideOnTracker(run: CommandRunner, issue: number, comment: string, always: boolean): string[] {
  const problems: string[] = [];
  let labelled = false;
  try {
    labelled = listIssueLabels(run, issue).some(l => l.toLowerCase() === NEEDS_HUMAN_LABEL);
  } catch (e) {
    problems.push(`could not read the labels of #${issue}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const commands = [`gh issue edit ${issue} --add-label ${NEEDS_HUMAN_LABEL}`];
  if (always || !labelled) commands.push(`gh issue comment ${issue} --body ${quote(comment)}`);
  for (const c of commands) {
    try {
      run(c);
    } catch (e) {
      problems.push(`could not run \`${c.slice(0, 40)}...\`: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return problems;
}
