import {
  formatReport as formatCheckReport,
  formatSummary,
  formatViolations,
  runArchCheck,
  runChecks,
  appendCheckRecords,
  applyWaivers,
  loadWaivers,
  runCoverageCheck,
  runDecisionsCheck,
  runGuardsCheck,
  runDocsCheck,
  runDocsWarnings,
  runHooksCheck,
  runBudgetsCheck,
  runDeliveryCheck,
  runJourneysCheck,
  updateBudgetsBaseline,
  runSafetyCheck,
  runSpecDecision,
  runStructureCheck,
  updateStructureBaseline,
  writeStructureBaseline,
  loadUiConfig,
  runA11y,
  runTestsCheck,
  runStatesCheck,
  runUiCheck,
  updateCoverageBaseline,
} from '../checks';
import {checkContract, contractItems, formatContract, resolveSandboxImage, findHarness, playwrightAuditor, playwrightScreenshotter, shellAppServer} from '../adapters';
import {loadConfig} from '../config';
import {checkSequencing} from '../backlog';
import {readOpenTickets} from './open-tickets';
import {WORKER_ITERATION_VAR, WORKER_TICKET_VAR, checkTicketCriteria, criterionOptions, placementProblems} from '../loop';
import {placementContext} from './placement-context';
import type {CommandRunner, Harness} from '../ports';
import {UiInfrastructureError} from '../ports';
import {harnessOfRoot} from './harness-of';
import {loopRootOf, realHookIo} from './hook';
import type {Command} from './command';
import {specProvider} from './spec-provider';

/** The ticket and iteration of the worker running this command; null outside one. */
function checkWorker(env: Record<string, string | undefined>): {ticket: string; iteration: number} | null {
  const ticket = env[WORKER_TICKET_VAR];
  const n = Number(env[WORKER_ITERATION_VAR]);
  return ticket ? {ticket, iteration: Number.isInteger(n) && n >= 0 ? n : 0} : null;
}

const SINGLE = {hooks: (root: string) => runHooksCheck(root, harnessOfRoot(root)), docs: runDocsCheck, arch: runArchCheck, decisions: runDecisionsCheck, guards: runGuardsCheck, safety: runSafetyCheck, delivery: (root: string) => runDeliveryCheck(root), journeys: (root: string, run: CommandRunner) => runJourneysCheck(root, run).findings, budgets: (root: string, run: CommandRunner) => runBudgetsCheck(root, run).findings, tests: runTestsCheck, coverage: runCoverageCheck, ui: runUiCheck};

export const check: Command = {
  name: 'check',
  needs: 'root',
  flags: ['json', 'summary', 'update', 'states', 'baseline'],
  help: `  check [--json | --summary]
                   Run every check the installed packs declare, apply .forger/waivers.json,
                   exit non-zero on any unwaived violation; --summary prints the CI job
                   summary in markdown
  check decisions [--json] Fail on a new dependency or layer-map change with no ADR in the diff
  check guards [--json]    Fail when the diff loosens a guard, skips or deletes a test and the ticket's Decisions do not name it
  check hooks [--json] Fail when the hook policy is missing or drops a default rule without a waiver, or the harness's settings do not run the hook
  check safety [--json] Fail on an added secret or a stored-shape change with no test
  check delivery [--json] Validate .forger/deliver.json (check required, commands non-empty, timeouts positive); runs none of the commands
  check journeys [--json] Start the app, run each journey in .forger/journeys.json and fail on one that exits non-zero; no journey named is a gap, not a pass
  check budgets [--json] [--update] Run each command in .forger/budgets.json and fail on a number worse than its recorded one, an output that is not a number or a failing command; a budget with no record is a gap; --update records new and better numbers and refuses a worse one
  check tests [--json] Fail on a fix with no test, or a unit test that imports a network or process module
  check coverage [--json] [--update] Fail when line coverage drops below the baseline; --update raises it
  check ui [--json] Fail when a branch changes UI files and updates no screenshot under docs/screenshots/, or a UI file holds a raw colour literal
  check ui --states [--json] Serve the app, load every named state at every viewport and theme, and fail on a state assertion in ui.json (console errors, not_blank, in_viewport, visible, hidden, colour); exit 2 when Playwright or the app is unavailable
  check a11y [--json] Serve the app and fail on serious or critical axe violations on every route, viewport and theme (exit 2 when Playwright, axe-core or the app is unavailable)
  check spec [--json] Fail when a requirement the issue names is unsatisfied or a MUST regresses; the slcr binary is the provider; none is a gap, not a pass
  check ticket N [--json] Fail when an acceptance criterion of issue N is not a named test, a command with its result, a sourced number or a named UI state, or uses a subjective word, or when it shares a footprint with another open ticket and neither is ordered against the other
  check sandbox [--json] Start the configured docker image with the image contract probes (git, bun, the harness CLI, a non-root user) and print one line per item; exit 0 only when every item passes, and 0 with nothing to check under the host sandbox
  check structure [--json] [--baseline | --update] Fail on a new folder over the size limit, prefix cluster, name that repeats its folder, file in a frozen folder, re-export shim, server file without its guard import, client file importing a server module, import across a declared boundary or import cycle; recorded ones in .forger/structure-baseline.json warn; --baseline writes the record once, --update drops entries that no longer hold
  check arch [--json] Fail on an import that crosses a forbidden edge of .forger/architecture.json
  check docs [--json] Fail on non-ASCII punctuation, emails, home paths, denylist terms and, with the docs pack, README writing rules; passive voice warns on stderr`,
  async run(ctx) {
    const {values, positionals, projectRoot, pluginRoot} = ctx;
    if (positionals[1] === 'ui' && values.states) {
      try {
        const findings = await runStatesCheck(loadUiConfig(projectRoot), shellAppServer(projectRoot), playwrightScreenshotter(projectRoot));
        console.log(values.json ? JSON.stringify(findings) : formatViolations(findings, 'ui states'));
        if (findings.length > 0) process.exitCode = 1;
      } catch (e) {
        console.error(values.json ? JSON.stringify({ok: false, infrastructure: e instanceof UiInfrastructureError, error: (e as Error).message}) : (e as Error).message);
        process.exitCode = e instanceof UiInfrastructureError ? 2 : 1;
      }
      return;
    }
    if (positionals[1] === 'a11y') {
      try {
        const findings = await runA11y(loadUiConfig(projectRoot), shellAppServer(projectRoot), playwrightAuditor(projectRoot));
        console.log(values.json ? JSON.stringify(findings) : formatViolations(findings, 'a11y'));
        if (findings.length > 0) process.exitCode = 1;
      } catch (e) {
        console.error(values.json ? JSON.stringify({ok: false, infrastructure: e instanceof UiInfrastructureError, error: (e as Error).message}) : (e as Error).message);
        process.exitCode = e instanceof UiInfrastructureError ? 2 : 1;
      }
      return;
    }
    if (positionals[1] === undefined) {
      try {
        const report = runChecks(projectRoot, pluginRoot, ctx.run(), specProvider(ctx), harnessOfRoot(projectRoot));
        console.log(values.json ? JSON.stringify(report) : values.summary ? formatSummary(report) : formatCheckReport(report));
        if (!report.ok) process.exitCode = 1;
        const warning = appendCheckRecords(report, checkWorker(process.env), loopRootOf(realHookIo, projectRoot, projectRoot), loadConfig(projectRoot).paths.checks);
        if (warning) console.error(warning);
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    if (positionals[1] === 'ticket') {
      const n = Number(positionals[2]);
      if (!Number.isInteger(n) || n <= 0) {
        console.error('check ticket: give the issue number, as in "check ticket 42"');
        process.exitCode = 1;
        return;
      }
      let body: string;
      try {
        body = ctx.run()(`gh issue view ${n} --json body --jq .body`);
      } catch (e) {
        console.error(`check ticket: could not read issue #${n}: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
      const config = loadConfig(projectRoot);
      const result = checkTicketCriteria(body, criterionOptions(projectRoot, config));
      let native: number[] = [];
      try {
        const open = readOpenTickets(ctx.capture(), config.tracker.label);
        const subject = open.find(t => t.number === n) ?? {number: n, body, native: []};
        native = subject.native;
        result.problems.push(...checkSequencing({...subject, body}, open));
      } catch (e) {
        result.warnings.push(`could not compare with the other open tickets: ${(e as Error).message}`);
      }
      try {
        result.problems.push(...placementProblems(body, placementContext(projectRoot, ctx.run(), native)));
      } catch (e) {
        result.warnings.push(`could not check the Placement against the structure: ${(e as Error).message}`);
      }
      result.ok = result.problems.length === 0;
      console.log(
        values.json
          ? JSON.stringify({issue: n, ok: result.ok, problems: result.problems, warnings: result.warnings, criteria: result.criteria})
          : (result.ok ? `#${n}: every acceptance criterion can be checked` : `#${n}: ${result.problems.length} problem(s)\n${result.problems.map(p => `- ${p}`).join('\n')}`) +
            result.warnings.map(w => `\nwarning: ${w}`).join('')
      );
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (positionals[1] === 'sandbox') {
      const config = loadConfig(projectRoot);
      if (config.sandbox !== 'docker') {
        console.log(values.json ? JSON.stringify({sandbox: config.sandbox, ok: true, items: []}) : `sandbox ${config.sandbox}: nothing to check`);
        return;
      }
      const run = ctx.capture();
      const found = resolveSandboxImage(run, projectRoot, config.sandbox_image, run('git remote get-url origin').stdout.trim());
      if ('error' in found) {
        console.error(values.json ? JSON.stringify({sandbox: 'docker', ok: false, error: found.error}) : found.error);
        process.exitCode = 1;
        return;
      }
      const results = checkContract(run, found.image, contractItems(config.harness));
      const ok = results.every(r => r.ok);
      console.log(values.json ? JSON.stringify({sandbox: 'docker', image: found.image, ok, items: results}) : formatContract(found.image, results).join('\n'));
      if (!ok) process.exitCode = 1;
      return;
    }
    if (positionals[1] === 'spec') {
      const {findings, gaps, summary} = runSpecDecision(ctx.run(), specProvider(ctx));
      console.log(values.json ? JSON.stringify({findings, gaps, summary}) : formatViolations(findings, 'spec') + gaps.map(g => `\ngap (${g.modality}): ${g.opinion}: ${g.detail}`).join(''));
      if (findings.length > 0 || gaps.some(g => g.modality === 'MUST')) process.exitCode = 1;
      return;
    }
    if (positionals[1] === 'structure') {
      try {
        const run = ctx.run();
        if (values.baseline || values.update) {
          const n = values.baseline ? writeStructureBaseline(projectRoot, run) : updateStructureBaseline(projectRoot, run);
          const out = values.baseline ? {baseline: 'written', entries: n} : {baseline: 'updated', removed: n};
          console.log(values.json ? JSON.stringify(out) : values.baseline ? `structure baseline: ${n} entries recorded` : `structure baseline: ${n} entries removed`);
          return;
        }
        const {findings, warnings} = runStructureCheck(projectRoot, run);
        const open = applyWaivers(findings, loadWaivers(projectRoot)).violations;
        const shape = (f: {file: string; line: number; rule: string; detail: string}) => ({rule: f.rule, path: f.file, line: f.line, message: f.detail});
        if (values.json) console.log(JSON.stringify({findings: open.map(shape), warnings: warnings.map(shape)}));
        else {
          console.log(formatViolations(open, 'structure'));
          for (const w of warnings) console.error(`warning: ${w.file}:${w.line}: ${w.rule}: ${w.detail}`);
        }
        if (open.length > 0) process.exitCode = 1;
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    if (!(positionals[1] in SINGLE)) {
      console.error('Usage: check [--json | --summary] | check docs|arch|structure|decisions|guards|hooks|safety|delivery|journeys|budgets|tests|coverage|ui|spec|a11y|sandbox [--json] | check coverage --update');
      process.exitCode = 1;
      return;
    }
    if (positionals[1] === 'coverage' && values.update) {
      try {
        const next = updateCoverageBaseline(projectRoot);
        const out = {updated: next !== null, line_coverage: next === null ? null : next / 100};
        console.log(values.json ? JSON.stringify(out) : next === null ? 'coverage baseline: unchanged' : `coverage baseline: raised to ${(next / 100).toFixed(2)}%`);
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    if (positionals[1] === 'budgets' && values.update) {
      try {
        const update = updateBudgetsBaseline(projectRoot, ctx.run());
        console.log(values.json ? JSON.stringify(update) : [...update.moved.map(n => `budget "${n}": recorded ${update.baseline[n]}`), ...update.refused, ...(update.moved.length + update.refused.length === 0 ? ['budgets baseline: unchanged'] : [])].join('\n'));
        if (update.refused.length > 0) process.exitCode = 1;
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    let violations;
    try {
      const run = ctx.run();
      const runOne = SINGLE[positionals[1] as keyof typeof SINGLE];
      violations = applyWaivers(runOne(projectRoot, run), loadWaivers(projectRoot)).violations;
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
      return;
    }
    console.log(values.json ? JSON.stringify(violations) : formatViolations(violations, positionals[1]));
    if (positionals[1] === 'docs') {
      for (const w of runDocsWarnings(projectRoot, ctx.run())) console.error(`warning: ${w.file}:${w.line}: ${w.rule}: ${w.detail}`);
    }
    if (violations.length > 0) process.exitCode = 1;
  },
};
