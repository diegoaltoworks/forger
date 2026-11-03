import {
  formatReport as formatCheckReport,
  formatSummary,
  formatViolations,
  runArchCheck,
  runChecks,
  runCoverageCheck,
  runDecisionsCheck,
  runDocsCheck,
  runSafetyCheck,
  loadUiConfig,
  runA11y,
  runTestsCheck,
  runUiCheck,
  updateCoverageBaseline,
} from '../checks';
import {playwrightAuditor, shellAppServer} from '../adapters';
import {UiInfrastructureError} from '../ports';
import type {Command} from './command';

const SINGLE = {docs: runDocsCheck, arch: runArchCheck, decisions: runDecisionsCheck, safety: runSafetyCheck, tests: runTestsCheck, coverage: runCoverageCheck, ui: runUiCheck};

export const check: Command = {
  name: 'check',
  needs: 'root',
  flags: ['json', 'summary', 'update'],
  help: `  check [--json | --summary]
                   Run every check the installed packs declare, apply .forger/waivers.json,
                   exit non-zero on any unwaived violation; --summary prints the CI job
                   summary in markdown
  check decisions [--json] Fail on a new dependency or layer-map change with no ADR in the diff
  check safety [--json] Fail on an added secret or a stored-shape change with no test
  check tests [--json] Fail on a fix with no test, or a unit test that imports a network or process module
  check coverage [--json] [--update] Fail when line coverage drops below the baseline; --update raises it
  check ui [--json] Fail when a branch changes UI files and updates no screenshot under docs/screenshots/, or a UI file holds a raw colour literal
  check a11y [--json] Serve the app and fail on serious or critical axe violations on every route, viewport and theme (exit 2 when Playwright, axe-core or the app is unavailable)
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
        const report = runChecks(projectRoot, pluginRoot, ctx.run());
        console.log(values.json ? JSON.stringify(report) : values.summary ? formatSummary(report) : formatCheckReport(report));
        if (!report.ok) process.exitCode = 1;
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    if (!(positionals[1] in SINGLE)) {
      console.error('Usage: check [--json | --summary] | check docs|arch|decisions|safety|tests|coverage|ui|a11y [--json] | check coverage --update');
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
