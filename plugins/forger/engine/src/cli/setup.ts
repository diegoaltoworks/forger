import {findHarness} from '../adapters';
import {formatSetup, formatUpgrade, loadPresets, offerPresets, parsePackList, runSetup, runUpgrade} from '../packs';
import type {Command} from './command';

export const setup: Command = {
  name: 'setup',
  needs: 'none',
  flags: ['json', 'gates', 'base-branch', 'tracker', 'preset', 'packs', 'upgrade', 'harness'],
  help: `  setup [--json] [--gates CMD] [--base-branch B] [--tracker KIND] [--preset NAME] [--packs A,B] [--harness H] [--upgrade]
                   Install the chosen opinion packs (default base) into .forger/, never overwriting,
                   and record them in .forger/forger.lock.json.
                   --harness H sets the harness (claude, opencode) and installs its commands
                   --upgrade brings installed packs to this plugin's version: untouched files take the
                   new version, refined files are kept, files both sides changed get <file>.upstream`,
  run({values, pluginRoot, installedSkills}) {
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
    let skills: Record<string, string> | undefined;
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
    const offered = offerPresets(loadPresets(pluginRoot), installedSkills());
    console.log(values.json ? JSON.stringify({...result, presets: offered.map(p => p.name)}) : formatSetup(result, offered.map(p => p.name)));
  },
};
