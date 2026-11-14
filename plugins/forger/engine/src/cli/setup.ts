import {ensureLabels, requireVerifyStatus, VERIFY_STATUS_CONTEXT, type RequireOutcome} from '../loop';
import {forgerPath, loadConfig} from '../config';
import {flavourRef, loadFlavour} from '../pipeline';
import {findHarness} from '../adapters';
import {runChecks} from '../checks';
import {harnessOfRoot} from './harness-of';
import {specProvider} from './spec-provider';
import {coverageAdvice, formatCoverageAdvice, formatSetup, failingChecksOf, formatUpgrade, formatUpgradeChecks, upgradeChangedFiles, type UpgradeChecks, readRepoFacts, type CoverageAdvice, loadPresets, offerPresets, parsePackList, runSetup, runUpgrade, trackedRuntimeFiles, formatTrackedRuntime, chooseStarter, hasSourceFile, loadStarters, withStarterPacks, type StarterManifest} from '../packs';
import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import {formatCredentialSetup, formatSandboxSetup, setupCredential, setupSandbox, type CredentialSetup, type SandboxSetup} from './setup-sandbox';
import {formatUnread, unreadChecks, type UnreadCheck} from './language-reach';
import type {Command, CommandContext} from './command';

/** setup runs before any `.forger/` exists, so outside a repository it acts where it was run. */
function setupRoot(ctx: CommandContext): string {
  try {
    return ctx.projectRoot;
  } catch {
    return process.cwd();
  }
}

interface LabelOutcome {
  created: string[];
  error?: string;
}

/** GitHub repositories only; a failure (no gh, no remote) is reported, not fatal, since the files are already installed. */
function createLabels(ctx: CommandContext): LabelOutcome {
  const config = loadConfig(setupRoot(ctx));
  if (config.tracker.kind !== 'github') return {created: []};
  try {
    return {created: ensureLabels(ctx.run(), config.tracker.label)};
  } catch (e) {
    return {created: [], error: `could not create the loop labels: ${(e as Error).message}`};
  }
}

/** GitHub repositories only, and never fatal: a token without admin rights is common, so the gap is reported for the owner to close. */
function requireVerify(ctx: CommandContext): RequireOutcome | undefined {
  const config = loadConfig(setupRoot(ctx));
  if (config.tracker.kind !== 'github') return undefined;
  return requireVerifyStatus(ctx.capture(), config.base_branch);
}

function formatRequire(r: RequireOutcome | undefined, branch: string): string[] {
  if (!r) return [];
  if (r.error) return [`! could not make ${branch} require ${VERIFY_STATUS_CONTEXT}: ${r.error}; add it to the branch protection by hand`];
  return r.added ? [`check   ${VERIFY_STATUS_CONTEXT} required on ${branch}`] : [];
}

const DEFAULT_REPORT = 'coverage/lcov.info';

/** Only when the testing pack is chosen; unreadable repository facts skip the advice rather than fail setup. */
function coverageNextStep(ctx: CommandContext, chosen: string[]): CoverageAdvice | undefined {
  if (!chosen.includes('testing')) return undefined;
  const root = setupRoot(ctx);
  try {
    const settingsPath = forgerPath(root, '.forger/testing.json');
    const settings = existsSync(settingsPath) ? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as {coverage_report?: unknown}) : {};
    const report = typeof settings.coverage_report === 'string' ? settings.coverage_report : DEFAULT_REPORT;
    return coverageAdvice({gates: loadConfig(root).gates, report, reportExists: existsSync(join(root, report)), facts: readRepoFacts(root)});
  } catch {
    return undefined;
  }
}

export const setup: Command = {
  name: 'setup',
  needs: 'none',
  flags: ['json', 'gates', 'base-branch', 'tracker', 'flavour', 'preset', 'packs', 'upgrade', 'harness', 'sandbox', 'credential', 'no-starter', 'starter'],
  help: `  setup [--json] [--gates CMD] [--base-branch B] [--tracker KIND] [--flavour NAME] [--packs A,B] [--harness H] [--sandbox S] [--credential KIND] [--starter NAME | --no-starter] [--upgrade]
                   Install the chosen opinion packs (default base and structure) into .forger/, never overwriting,
                   and record them in .forger/forger.lock.json. On a GitHub tracker it creates the loop
                   labels and makes the base branch require the forger/verify check, when the token can.
                   It installs forger's tool-call hook into the harness's project settings, keeping
                   a settings file that already runs it.
                   It also lists each runtime file git tracks, with the git rm --cached command that stops tracking it; it runs none.
                   --flavour NAME records the flavour (shipped or in .forger/flavours/) the config picks skills with;
                   --preset NAME is the same
                   --harness H sets the harness (claude, opencode, codex, copilot) and installs its commands
                   --sandbox S sets where workers run (host or docker); docker also checks that the Docker API is reachable
                   --credential KIND sets whether the harness's model credential is an api_key or a subscription token,
                   and says how to make a subscription token for headless use
                   --starter NAME copies the named starter skeleton (default for a repository with no source file: Bun and TypeScript),
                   sets the gates to its own and installs the packs it is configured for; --no-starter copies none; never overwrites
                   --upgrade installs the default packs the project lacks, then brings installed packs to this plugin's version: untouched files take the
                   new version, refined files are kept, files both sides changed get <file>.upstream;
                   when it wrote a file or added a pack it then runs the checks and names each one that fails (failing_checks with --json)`,
  run(ctx) {
    const {values, pluginRoot, installedSkills} = ctx;
    if (values.upgrade) {
      try {
        const upgrade = runUpgrade(setupRoot(ctx), pluginRoot, c => ctx.run()(c));
        const unread = unreadChecks(setupRoot(ctx), pluginRoot, c => ctx.run()(c));
        const tracked = trackedRuntimeFiles(setupRoot(ctx), c => ctx.run()(c));
        let checks: UpgradeChecks | undefined;
        if (upgradeChangedFiles(upgrade)) {
          try {
            checks = {failing: failingChecksOf(runChecks(setupRoot(ctx), pluginRoot, ctx.run(), specProvider(ctx), harnessOfRoot(setupRoot(ctx))))};
          } catch (e) {
            checks = {error: (e as Error).message};
          }
        }
        const checked = checks && 'failing' in checks ? {failing_checks: checks.failing} : checks ? {checks_error: checks.error} : {};
        console.log(values.json ? JSON.stringify({...upgrade, ...(unread.length > 0 ? {unread} : {}), ...(tracked.length > 0 ? {tracked_runtime: tracked} : {}), ...checked}) : [formatUpgrade(upgrade), ...formatUnread(unread), ...formatTrackedRuntime(tracked), ...(checks ? formatUpgradeChecks(checks) : [])].join('\n'));
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    let flavour: string | undefined;
    const wanted = (values.flavour ?? values.preset) as string | undefined;
    if (wanted) {
      try {
        flavour = flavourRef(loadFlavour(pluginRoot, forgerPath(setupRoot(ctx), '.forger'), wanted));
      } catch (e) {
        console.error(`Unknown flavour: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
    }
    let result;
    let starter: StarterManifest | undefined;
    try {
      const harness = values.harness ? findHarness(values.harness) : undefined;
      const choice = chooseStarter({
        hasSource: hasSourceFile(setupRoot(ctx)),
        noStarter: values['no-starter'] === true,
        wanted: values.starter as string | undefined,
        available: loadStarters(pluginRoot),
      });
      starter = choice.kind === 'use' ? choice.starter : undefined;
      result = runSetup(setupRoot(ctx), pluginRoot, {
        packs: parsePackList(values.packs),
        gates: values.gates,
        run: c => ctx.run()(c),
        baseBranch: values['base-branch'],
        trackerKind: values.tracker,
        flavour,
        starter,
        harness,
        hookHarness: harness ?? findHarness(loadConfig(setupRoot(ctx)).harness),
      });
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
      return;
    }
    let box: SandboxSetup | undefined;
    if (values.sandbox) {
      try {
        box = setupSandbox(setupRoot(ctx), values.sandbox, ctx.capture());
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
        return;
      }
      if (box.docker && (!box.docker.reachable || !box.docker.image)) process.exitCode = 1;
    }
    const unread: UnreadCheck[] = unreadChecks(setupRoot(ctx), pluginRoot, c => ctx.run()(c));
    let credential: CredentialSetup | undefined;
    if (values.credential) {
      try {
        credential = setupCredential(setupRoot(ctx), findHarness(values.harness ?? loadConfig(setupRoot(ctx)).harness), values.credential);
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
        return;
      }
    }
    const tracked = trackedRuntimeFiles(setupRoot(ctx), c => ctx.run()(c));
    const labels = createLabels(ctx);
    const verifyCheck = requireVerify(ctx);
    const coverage = coverageNextStep(ctx, starter ? withStarterPacks(parsePackList(values.packs), starter) : parsePackList(values.packs));
    const offered = offerPresets(loadPresets(pluginRoot), installedSkills());
    const presets = offered.map(p => p.name);
    if (values.json) console.log(JSON.stringify({...result, ...(unread.length > 0 ? {unread} : {}), ...(tracked.length > 0 ? {tracked_runtime: tracked} : {}), presets, labels, ...(box ? {sandbox: box} : {}), ...(credential ? {credential} : {}), ...(verifyCheck ? {verify_check: verifyCheck} : {}), ...(coverage ? {coverage, next_steps: coverage.next_steps} : {})}));
    else
      console.log(
        [
          formatSetup(result, presets),
          ...formatUnread(unread),
          ...formatTrackedRuntime(tracked),
          ...(box ? formatSandboxSetup(box) : []),
          ...(credential ? formatCredentialSetup(credential) : []),
          ...labels.created.map(l => `label   ${l}`),
          ...(labels.error ? [`! ${labels.error}`] : []),
          ...formatRequire(verifyCheck, loadConfig(setupRoot(ctx)).base_branch),
          ...(coverage ? [formatCoverageAdvice(coverage)] : []),
        ].join('\n')
      );
  },
};
