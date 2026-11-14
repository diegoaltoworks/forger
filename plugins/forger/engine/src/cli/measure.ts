import {playwrightScreenshotter, shellAppServer} from '../adapters';
import {UiInfrastructureError} from '../ports';
import {UI_PATH, UiConfigError, formatFitReport, longestString, parseUiConfig, runFit} from '../ui';
import {forgerPath} from '../config';
import {JOURNEYS_PATH, loadJourneysConfig} from '../checks';
import {existsSync, readdirSync, readFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

import {parseAllEvents, parseEvents, loopRootOf, readAllVerdicts, readSchedule, verdictsHome} from '../loop';
import {LOCK_PATH, listOpinions, loadPacks, parseLock} from '../packs';
import {computeNoneSections, computeOpinionFailures, formatNoneSections, formatOpinionFailures, sectionNames, type FailureRecord} from '../supervisor';
import {buildComparisonReport, DEFAULT_PRICES, mergePrices, sessionCostUsd, type PriceTable, type Measures, computeMeasures, diffReports, parseDiffRanges, parseReplacedRanges, picksToPrs, DEFAULT_REWORK_WINDOW, type MergedPr, type TrackerIssue, type ReworkInputs, type ComparisonReport, formatMeasures, parseBudgets, parseIterationLog, type CiRun, type IterationRecord, type OpinionFailures} from '../supervisor';
import type {Rung} from '../packs';
import type {Command, CommandContext} from './command';

/** The transcript a session left, searched under every project folder of the harness's config dir; null when there is none. */
function readTranscript(sessionId: string): string | null {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return readFileSync(file, 'utf-8');
  }
  // The work log of older runs holds only the first characters of the id.
  if (sessionId.length >= 8) {
    for (const dir of readdirSync(projects)) {
      const found = readdirSync(join(projects, dir)).filter(f => f.startsWith(sessionId) && f.endsWith('.jsonl'));
      if (found.length === 1) return readFileSync(join(projects, dir, found[0]), 'utf-8');
    }
  }
  return null;
}

function readPrices(projectRoot: string): PriceTable {
  const file = join(projectRoot, '.forger/prices.json');
  if (!existsSync(file)) return DEFAULT_PRICES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    throw new Error('.forger/prices.json is not valid JSON');
  }
  const merged = mergePrices(DEFAULT_PRICES, parsed);
  if (merged === null) throw new Error('.forger/prices.json must map a model name to {input, output, cache_read, cache_write} dollars per million tokens');
  return merged;
}

interface GhPr {
  number: number;
  title: string;
  body: string;
  closingIssuesReferences?: {number: number}[];
}

/** Merged PRs oldest first with their touched lines, and the issues; null when gh cannot read them. */
function gatherChanges(run: (cmd: string) => string, iterations: IterationRecord[], picked: {iteration: number; ticket: string | null}[], window: number, limit: number): ReworkInputs | null {
  try {
    const listed = (JSON.parse(run(`gh pr list --state merged --limit ${limit} --json number,title,body,closingIssuesReferences`)) as GhPr[]).reverse();
    const prs: MergedPr[] = listed.map((p, order) => {
      let ranges: MergedPr['ranges'] = [];
      let replaced: MergedPr['ranges'] = [];
      try {
        const diff = run(`gh pr diff ${p.number}`);
        ranges = parseDiffRanges(diff);
        replaced = parseReplacedRanges(diff);
      } catch {
        // A PR whose diff cannot be read has no overlap evidence, not an error.
      }
      return {number: p.number, order, title: p.title, body: p.body ?? '', closes: p.closingIssuesReferences?.[0]?.number ?? null, ranges, replaced};
    });
    const raw = JSON.parse(run(`gh issue list --state all --label bug --limit ${limit} --json number,labels,body`)) as {number: number; labels: {name: string}[]; body: string}[];
    const issues: TrackerIssue[] = raw.map(i => ({number: i.number, labels: i.labels.map(l => l.name), body: i.body ?? ''}));
    return {prs, issues, picks: picksToPrs(picked, iterations, prs), window};
  } catch {
    return null;
  }
}

/** Reads the logs, the transcripts and the tracker into the measures; the arithmetic is in `computeMeasures`. */
export function gatherMeasures(ctx: CommandContext): Measures {
  const {values, projectRoot, config} = ctx;
  const outDir = join(projectRoot, config.paths.output);
  const iterations: IterationRecord[] = existsSync(outDir)
    ? readdirSync(outDir)
        .filter(f => /^iteration-\d+\.log$/.test(f))
        .flatMap(f => parseIterationLog(readFileSync(join(outDir, f), 'utf-8')) ?? [])
    : [];
  const workLog = join(projectRoot, config.paths.log);
  let ciRuns: CiRun[] = [];
  try {
    ciRuns = JSON.parse(ctx.run()('gh run list --limit 500 --json headBranch,event')) as CiRun[];
  } catch {
    // No CI, no gh or offline: CI rounds are reported as unknown.
  }
  const budgets = existsSync(workLog) ? parseBudgets(readFileSync(workLog, 'utf-8')) : [];
  const prices = readPrices(projectRoot);
  const sessionCosts: Record<string, number | null> = {};
  for (const b of budgets) if (b.sessionId !== undefined) sessionCosts[b.sessionId] = sessionCostUsd(readTranscript(b.sessionId), prices);
  const window = values.window === undefined ? DEFAULT_REWORK_WINDOW : parseInt(values.window, 10);
  if (!(window >= 1)) throw new Error('--window must be a whole number of merges, 1 or more');
  const picked = parseAllEvents(ctx.stateStore.readEvents()).filter(e => e.event === 'picked');
  const changes = gatherChanges(ctx.run(), iterations, picked, window, 100);
  const notHere = [
    ...(iterations.length === 0 ? ['iteration logs'] : []),
    ...(Object.values(sessionCosts).some(c => c === null) ? ['session transcripts'] : []),
  ];
  const journeysFile = forgerPath(projectRoot, JOURNEYS_PATH);
  const allEvents = parseAllEvents(ctx.stateStore.readEvents());
  const measures = computeMeasures({
    ...(existsSync(journeysFile) ? {journeys: loadJourneysConfig(projectRoot).journeys} : {}),
    ...(changes === null ? {} : {changes}),
    iterations,
    budgets,
    sessionCosts,
    verdicts: readAllVerdicts(verdictsHome(ctx.run(), projectRoot, config.paths.verdicts)),
    schedule: readSchedule(join(outDir, 'schedule-decisions.jsonl')),
    events: parseEvents(ctx.stateStore.readEvents()),
    records: allEvents,
    clears: allEvents.filter(e => e.event === 'halt_cleared'),
    denials: allEvents.filter(e => e.event === 'worker_denied'),
    ciRuns,
    last: values.last === undefined ? null : parseInt(values.last, 10),
  });
return {...measures, not_on_this_machine: notHere};
}

export const measure: Command = {
  name: 'measure',
  needs: 'config',
  flags: ['json', 'last', 'report', 'diff', 'window', 'from', 'text', 'opinions'],
  help: `  measure [--json] [--last N] [--window N] [--report] [--from local|branch]
  measure --diff A.json B.json
  measure --opinions [--json]
                   Per installed opinion with a check: failed runs, tickets that failed, and how they ended (fixed, waived, open), most failures first, those that never failed last; and per section of the ticket template, how many merged tickets answered none
  measure <route-or-state> <selector> [--text <file>] [--json]
                   Serves the app and, for each element the selector matches, reports its text width against the width available, and whether it wraps or is clipped,
                   at each viewport (and each locale of ui.json) at a text scale of 100% and 200%. The worst case is first (exit 1 when any wraps or is clipped; exit 2 when the app cannot be served).
                   --text fills the element with the longest string of a translation file (JSON of any nesting, else one string per line) first
                   Runs, failures by cause, time, budget cap, cost from the session transcripts (unknown without one; prices in .forger/prices.json override the defaults) and CI rounds per ticket; merges per hour by parallelism, conflicts, rework, redone tickets, owner interventions, and the calls the worker's hook refused, by rule and by ticket.
                   Rework and escaped defects per merged PR: a later merge within --window N merges (default 5) that touches its lines or reverts it, bug issues naming it, and picks that differ from the issue the PR closed.
                   --from branch reads the state record and events from the state branch of a clone; iteration logs and transcripts stay on the engine's machine and are reported as not on this machine.
                   --report prints the five-measure comparison report as JSON; --diff prints the per-measure delta between two saved reports (A is the baseline)`,
  async run(ctx) {
    const {values, projectRoot, config, positionals} = ctx;
    if (values.opinions) return measureOpinions(ctx);
    if (positionals[1] !== undefined && !values.diff) return measureFit(ctx);
    if (values.diff) {
      const [a, b] = [positionals[1], positionals[2]];
      if (a === undefined || b === undefined) throw new Error('measure --diff needs two report files: measure --diff A.json B.json');
      const read = (f: string) => JSON.parse(readFileSync(f, 'utf-8')) as ComparisonReport;
      console.log(JSON.stringify(diffReports(read(a), read(b))));
      return;
    }
    const measures = gatherMeasures(ctx);
    if (values.report) {
      console.log(JSON.stringify(buildComparisonReport(measures)));
      return;
    }
    console.log(values.json ? JSON.stringify(measures) : formatMeasures(measures));
  },
};

/** Exit 1 is a config or target the project must fix, or text that does not fit; exit 2 is an environment that cannot serve the app. */
async function measureFit(ctx: CommandContext): Promise<void> {
  const {values, projectRoot, positionals} = ctx;
  const fail = (message: string, code: number): void => {
    console.error(values.json ? JSON.stringify({ok: false, error: message}) : message);
    process.exitCode = code;
  };
  const [target, selector] = [positionals[1], positionals[2]];
  if (target === undefined || selector === undefined) return fail('measure: give a route or state and a selector, as in: measure /settings ".title"', 1);
  const path = forgerPath(projectRoot, UI_PATH);
  if (!existsSync(path)) return fail(`${UI_PATH} not found; install the ui pack with setup`, 1);
  try {
    const config = parseUiConfig(readFileSync(path, 'utf-8'));
    if (values.text !== undefined && !existsSync(values.text)) return fail(`measure: ${values.text} not found`, 1);
    const text = values.text === undefined ? undefined : longestString(readFileSync(values.text, 'utf-8'));
    const report = await runFit(config, target, selector, shellAppServer(projectRoot), playwrightScreenshotter(projectRoot), text);
    console.log(values.json ? JSON.stringify(report) : formatFitReport(report));
    if (!report.fits) process.exitCode = 1;
  } catch (e) {
    if (e instanceof UiInfrastructureError) return fail(e.message, 2);
    if (e instanceof UiConfigError) return fail(e.message, 1);
    throw e;
  }
}

/** The check records, oldest first; null when the file is not there. */
function readCheckRecords(file: string): FailureRecord[] | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(l => l.trim() !== '')
    .flatMap(l => {
      try {
        return [JSON.parse(l) as FailureRecord];
      } catch {
        return [];
      }
    });
}

/** Tickets whose PR merged, and the bodies of their issues; empty when gh cannot read them. */
function mergedTickets(run: (cmd: string) => string): {tickets: Set<string>; bodies: string[]} {
  try {
    const prs = JSON.parse(run('gh pr list --state merged --limit 100 --json closingIssuesReferences')) as {closingIssuesReferences?: {number: number}[]}[];
    const numbers = new Set(prs.flatMap(p => (p.closingIssuesReferences ?? []).map(i => i.number)));
    const issues = JSON.parse(run('gh issue list --state all --limit 200 --json number,body')) as {number: number; body: string}[];
    return {tickets: new Set([...numbers].map(n => `issue-${n}`)), bodies: issues.filter(i => numbers.has(i.number)).map(i => i.body ?? '')};
  } catch {
    return {tickets: new Set(), bodies: []};
  }
}

/** Per-opinion failure rows with each opinion's rung and the merged-ticket count; null when no check has written records. */
export function loadOpinionFailures(ctx: CommandContext): {rows: OpinionFailures[]; rungs: Map<string, Rung>; merged: number; sections: ReturnType<typeof computeNoneSections>} | null {
  const {projectRoot, config, pluginRoot} = ctx;
  const records = readCheckRecords(join(loopRootOf(ctx.run(), projectRoot), config.paths.checks));
  if (records === null) return null;
  const lockFile = join(projectRoot, LOCK_PATH);
  const installed = existsSync(lockFile) ? listOpinions(loadPacks(pluginRoot), parseLock(readFileSync(lockFile, 'utf-8'))) : [];
  const {tickets, bodies} = mergedTickets(ctx.run());
  const installedTemplate = join(projectRoot, '.forger/templates/ticket.md');
  const template = [installedTemplate, join(pluginRoot, 'packs/base/files/ticket.md')].find(f => existsSync(f));
  const checked = installed.filter(o => o.check !== null);
  return {
    rows: computeOpinionFailures(records, checked, tickets),
    rungs: new Map(checked.map(o => [o.id, o.rung])),
    merged: tickets.size,
    sections: computeNoneSections(template === undefined ? [] : sectionNames(readFileSync(template, 'utf-8')), bodies),
  };
}

function measureOpinions(ctx: CommandContext): void {
  const {values} = ctx;
  const loaded = loadOpinionFailures(ctx);
  if (loaded === null) {
    console.log(values.json ? JSON.stringify({recorded: false}) : 'nothing is recorded yet: no check run inside a worker has written records');
    return;
  }
  const {rows, sections} = loaded;
  console.log(values.json ? JSON.stringify({recorded: true, opinions: rows, sections}) : [formatOpinionFailures(rows), formatNoneSections(sections)].filter(Boolean).join('\n\n'));
}
