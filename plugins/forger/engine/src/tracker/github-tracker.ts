/** The Tracker port over GitHub, through the two runners a command is handed. */

import {capturing, type CapturingRunner, type CommandResult, type CommandRunner, type QueueHome, type TicketFacts, type TicketState, type Tracker, type TrackerWrite, type WholeResult} from '../ports';
import {githubCommand, githubRead} from './github-command';

function lines(out: string): string[] {
  return out.split('\n').map(l => l.trim()).filter(Boolean);
}

export function githubTracker(run: CommandRunner, capture: CapturingRunner = capturing(run), queue: QueueHome = 'tracker'): Tracker {
  /** The plain runner unless the caller asks for the whole result. */
  function call(cmd: string): string;
  function call(cmd: string, how: WholeResult): CommandResult;
  function call(cmd: string, how?: WholeResult): string | CommandResult {
    return how ? capture(cmd) : run(cmd);
  }
  return {
    queue,
    text: ((n: number, how?: WholeResult) => (how ? call(githubRead.text(n), how) : call(githubRead.text(n)))) as Tracker['text'],
    facts(n): TicketFacts {
      const data = JSON.parse(call(githubRead.facts(n))) as {labels?: Array<{name: string}>; body?: string};
      return {labels: (data.labels ?? []).map(l => l.name), body: data.body ?? ''};
    },
    labels: n => lines(call(githubRead.labels(n))),
    state(n): TicketState {
      const data = JSON.parse(call(githubRead.state(n))) as {state?: string; closedByPullRequestsReferences?: Array<{number?: number}>};
      return {state: data.state ?? 'UNKNOWN', closedBy: (data.closedByPullRequestsReferences ?? []).map(r => r.number).filter((x): x is number => typeof x === 'number')};
    },
    lastComment: n => call(githubRead.lastComment(n)).trim(),
    exists: n => call(githubRead.exists(n), {whole: true}).exitCode === 0,
    list: q => JSON.parse(call(githubRead.list(q))) as Array<{number: number; title: string}>,
    repoLabels: () => lines(call(githubRead.repoLabels())),
    account: ((how?: WholeResult) => (how ? call(githubRead.account(), how) : call(githubRead.account()))) as Tracker['account'],
    apply: ((write: TrackerWrite, how?: WholeResult) => (how ? call(githubCommand(write), how) : call(githubCommand(write)))) as Tracker['apply'],
  };
}
