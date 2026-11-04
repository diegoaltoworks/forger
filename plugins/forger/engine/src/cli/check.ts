import {
  formatReport as formatCheckReport,
  formatSummary,
  formatViolations,
  runArchCheck,
  runChecks,
  runCoverageCheck,
  runDecisionsCheck,
  runDocsCheck,
  runHooksCheck,
  runSafetyCheck,
  runSpecDecision,
  loadUiConfig,
  runA11y,
  runTestsCheck,
  runUiCheck,
  updateCoverageBaseline,
} from '../checks';
import {findHarness, playwrightAuditor, shellAppServer} from '../adapters';
import {loadConfig} from '../config';
import type {Harness} from '../ports';
import {UiInfrastructureError} from '../ports';
import type {Command} from './command';
import {specProvider} from './spec-provider';

/** The project's harness, for the checks that read its settings; an unknown one leaves them nothing to read. */
function harnessOf(projectRoot: string): Harness | undefined {
  try {
    return findHarness(loadConfig(projectRoot).harness);
  } catch {
    return undefined;
  }
}

const SINGLE = {hooks: (root: string) => runHooksCheck(root, harnessOf(root)), docs: runDocsCheck, arch: runArchCheck, decisions: runDecisionsCheck, safety: runSafetyCheck, tests: runTestsCheck, coverage: runCoverageCheck, ui: runUiCheck};

export const check: Command = {
  name: 'check',
  needs: 'root',
  flags: ['json', 'summary', 'update'],
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
  check a11y [--json] Serve the app and fail on serious or critical axe violations on every route, viewport and theme (exit 2 when Playwright, axe-core or the app is unavailable)
  check spec [--json] Fail when a requirement the issue names is unsatisfied or a MUST regresses; the slcr binary is the provider; none is a gap, not a pass
  check arch [--json] Fail on an import that crosses a forbidden edge of .forger/architecture.json
  check docs [--json] Fail on non-ASCII punctuation, emails, home paths, denylist terms`,
  async run(ctx) {
    const {values, positionals, projectRoot, pluginRoot} = ctx;
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
        const report = runChecks(projectRoot, pluginRoot, ctx.run(), specProvider(ctx), harnessOf(projectRoot));
        console.log(values.json ? JSON.stringify(report) : values.summary ? formatSummary(report) : formatCheckReport(report));
        if (!report.ok) process.exitCode = 1;
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
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
      violations = runOne(projectRoot, run);
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
      return;
    }
    console.log(values.json ? JSON.stringify(violations) : formatViolations(violations, positionals[1]));
    if (violations.length > 0) process.exitCode = 1;
  },
};
