import {ensureLabels, requireVerifyStatus, VERIFY_STATUS_CONTEXT, type RequireOutcome} from '../loop';
import {loadConfig, type SkillMapping} from '../config';
import {findHarness} from '../adapters';
import {formatSetup, formatUpgrade, loadPresets, offerPresets, parsePackList, runSetup, runUpgrade} from '../packs';
import type {Command, CommandContext} from './command';

interface LabelOutcome {
  created: string[];
  error?: string;
}

/** GitHub repositories only; a failure (no gh, no remote) is reported, not fatal, since the files are already installed. */
function createLabels(ctx: CommandContext): LabelOutcome {
  const config = loadConfig(process.cwd());
  if (config.tracker.kind !== 'github') return {created: []};
  try {
    return {created: ensureLabels(ctx.run(), config.tracker.label)};
  } catch (e) {
    return {created: [], error: `could not create the loop labels: ${(e as Error).message}`};
  }
}

/** GitHub repositories only, and never fatal: a token without admin rights is common, so the gap is reported for the owner to close. */
function requireVerify(ctx: CommandContext): RequireOutcome | undefined {
  const config = loadConfig(process.cwd());
  if (config.tracker.kind !== 'github') return undefined;
  return requireVerifyStatus(ctx.capture(), config.base_branch);
}

function formatRequire(r: RequireOutcome | undefined, branch: string): string[] {
  if (!r) return [];
  if (r.error) return [`! could not make ${branch} require ${VERIFY_STATUS_CONTEXT}: ${r.error}; add it to the branch protection by hand`];
  return r.added ? [`check   ${VERIFY_STATUS_CONTEXT} required on ${branch}`] : [];
}

export const setup: Command = {
  name: 'setup',
  needs: 'none',
  flags: ['json', 'gates', 'base-branch', 'tracker', 'preset', 'packs', 'upgrade', 'harness'],
  help: `  setup [--json] [--gates CMD] [--base-branch B] [--tracker KIND] [--preset NAME] [--packs A,B] [--harness H] [--upgrade]
                   Install the chosen opinion packs (default base) into .forger/, never overwriting,
                   and record them in .forger/forger.lock.json. On a GitHub tracker it creates the loop
                   labels and makes the base branch require the forger/verify check, when the token can.
                   --harness H sets the harness (claude, opencode, codex, copilot) and installs its commands
                   --upgrade brings installed packs to this plugin's version: untouched files take the
                   new version, refined files are kept, files both sides changed get <file>.upstream`,
  run(ctx) {
    const {values, pluginRoot, installedSkills} = ctx;
    if (values.upgrade) {
      try {
        const upgrade = runUpgrade(process.cwd(), pluginRoot);
        console.log(values.json ? JSON.stringify(upgrade) : formatUpgrade(upgrade));
      } catch (e) {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
      return;
    }
    let skills: Record<string, SkillMapping> | undefined;
    if (values.preset) {
      const preset = loadPresets(pluginRoot).find(p => p.name === values.preset);
      if (!preset) {
        console.error(`Unknown preset: ${values.preset}`);
        process.exitCode = 1;
        return;
      }
      skills = preset.skills;
    }
    let result;
    try {
      const harness = values.harness ? findHarness(values.harness) : undefined;
      result = runSetup(process.cwd(), pluginRoot, {
        packs: parsePackList(values.packs),
        gates: values.gates,
        baseBranch: values['base-branch'],
        trackerKind: values.tracker,
        skills,
        harness,
      });
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
      return;
    }
    const labels = createLabels(ctx);
    const verifyCheck = requireVerify(ctx);
    const offered = offerPresets(loadPresets(pluginRoot), installedSkills());
    const presets = offered.map(p => p.name);
    if (values.json) console.log(JSON.stringify({...result, presets, labels, ...(verifyCheck ? {verify_check: verifyCheck} : {})}));
    else
      console.log(
        [
          formatSetup(result, presets),
          ...labels.created.map(l => `label   ${l}`),
          ...(labels.error ? [`! ${labels.error}`] : []),
          ...formatRequire(verifyCheck, loadConfig(process.cwd()).base_branch),
        ].join('\n')
      );
  },
};
