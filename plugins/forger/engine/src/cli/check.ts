import {
  formatReport as formatCheckReport,
  formatSummary,
  formatViolations,
  runArchCheck,
  runChecks,
  applyWaivers,
  loadWaivers,
  runCoverageCheck,
  runDecisionsCheck,
  runDocsCheck,
  runDocsWarnings,
  runHooksCheck,
  runSafetyCheck,
  runSpecDecision,
  loadUiConfig,
  runA11y,
  runTestsCheck,
  runStatesCheck,
  runUiCheck,
  updateCoverageBaseline,
} from '../checks';
import {findHarness, playwrightAuditor, playwrightScreenshotter, shellAppServer} from '../adapters';
import {loadConfig} from '../config';
import {checkTicketCriteria, criterionOptions} from '../loop';
import type {Harness} from '../ports';
import {UiInfrastructureError} from '../ports';
import {harnessOfRoot} from './harness-of';
import type {Command} from './command';
import {specProvider} from './spec-provider';

const SINGLE = {hooks: (root: string) => runHooksCheck(root, harnessOfRoot(root)), docs: runDocsCheck, arch: runArchCheck, decisions: runDecisionsCheck, safety: runSafetyCheck, tests: runTestsCheck, coverage: runCoverageCheck, ui: runUiCheck};

export const check: Command = {
  name: 'check',
  needs: 'root',
  flags: ['json', 'summary', 'update', 'states'],
  help: `  check [--json | --summary]
                   Run every check the installed packs declare, apply .forger/waivers.json,
                   exit non-zero on any unwaived violation; --summary prints the CI job
                   summary in markdown
  check decisions [--json] Fail on a new dependency or layer-map change with no ADR in the diff
  check hooks [--json] Fail when the hook policy is missing or drops a default rule without a waiver, or the harness's settings do not run the hook
  check safety [--json] Fail on an added secret or a stored-shape change with no test
  check tests [--json] Fail on a fix with no test, or a unit test that imports a network or process module
  check coverage [--json] [--update] Fail when line coverage drops below the baseline; --update raises it
  check ui [--json] Fail when a branch changes UI files and updates no screenshot under docs/screenshots/, or a UI file holds a raw colour literal
  check ui --states [--json] Serve the app, load every named state at every viewport and theme, and fail on a state assertion in ui.json (console errors, not_blank, in_viewport, visible, hidden, colour); exit 2 when Playwright or the app is unavailable
  check a11y [--json] Serve the app and fail on serious or critical axe violations on every route, viewport and theme (exit 2 when Playwright, axe-core or the app is unavailable)
  check spec [--json] Fail when a requirement the issue names is unsatisfied or a MUST regresses; the slcr binary is the provider; none is a gap, not a pass
  check ticket N [--json] Fail when an acceptance criterion of issue N is not a named test, a command with its result, a sourced number or a named UI state, or uses a subjective word
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
      const result = checkTicketCriteria(body, criterionOptions(projectRoot, loadConfig(projectRoot)));
      console.log(
        values.json
          ? JSON.stringify({issue: n, ok: result.ok, problems: result.problems, criteria: result.criteria})
          : result.ok ? `#${n}: every acceptance criterion can be checked` : `#${n}: ${result.problems.length} problem(s)\n${result.problems.map(p => `- ${p}`).join('\n')}`
      );
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (positionals[1] === 'spec') {
      const {findings, gaps, summary} = runSpecDecision(ctx.run(), specProvider(ctx));
      console.log(values.json ? JSON.stringify({findings, gaps, summary}) : formatViolations(findings, 'spec') + gaps.map(g => `\ngap (${g.modality}): ${g.opinion}: ${g.detail}`).join(''));
      if (findings.length > 0 || gaps.some(g => g.modality === 'MUST')) process.exitCode = 1;
      return;
    }
    if (!(positionals[1] in SINGLE)) {
      console.error('Usage: check [--json | --summary] | check docs|arch|decisions|hooks|safety|tests|coverage|ui|spec|a11y [--json] | check coverage --update');
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
