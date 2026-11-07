import {appendDecision, decisionEntry, haltedOnIssue, parseAllEvents, standingHalt} from '../loop';
import type {Command} from './command';

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function refuse(message: string): void {
  console.error(`decide: ${message}`);
  process.exitCode = 1;
}

export const decide: Command = {
  name: 'decide',
  needs: 'loop',
  flags: ['json'],
  help: `  decide <n> "<text>" [--json]
                   Record the owner's answer under the Decisions section of issue <n>, with who decided and the date;
                   when the loop is halted on that ticket, the halt is cleared with <n> as the cause`,
  run(ctx) {
    const {positionals, values, config, runner, stateStore} = ctx;
    const raw = positionals[1] ?? '';
    const text = (positionals[2] ?? '').trim();
    if (!/^#?\d+$/.test(raw) || text === '') return refuse('usage: decide <issue-number> "<text>"');
    const issue = parseInt(raw.replace(/^#/, ''), 10);
    if (config.tracker.kind !== 'github') return refuse('decisions are recorded on a GitHub issue; the tracker is not github');
    const run = ctx.capture();
    const view = run(`gh issue view ${issue} --json body --jq .body`);
    if (view.exitCode !== 0) return refuse(`#${issue} is not an issue in the tracker`);
    const who = run('gh api user --jq .login');
    const login = who.exitCode === 0 ? who.stdout.trim() : '';
    if (login === '') return refuse('cannot tell who is deciding; gh api user returned no login');
    const date = new Date().toISOString().slice(0, 10);
    const body = appendDecision(view.stdout, decisionEntry(text, login, date));
    const edit = run(`gh issue edit ${issue} --body ${quote(body)}`);
    if (edit.exitCode !== 0) return refuse(`could not update #${issue}`);
    const halt = standingHalt(parseAllEvents(stateStore.readEvents()));
    const cleared = haltedOnIssue(halt, issue);
    if (cleared) runner.clearHalt('halt_cleared', null, {cause: issue, notADefect: null}, text);
    if (values.json) console.log(JSON.stringify({issue, decided_by: login, date, halt_cleared: cleared}));
    else console.log(`Recorded under Decisions on #${issue}.${cleared ? ' The halt on this ticket is cleared.' : ''}`);
  },
};
