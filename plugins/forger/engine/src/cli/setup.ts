import {formatSetup, loadPresets, offerPresets, parsePackList, runSetup} from '../packs';
import type {Command} from './command';

export const setup: Command = {
  name: 'setup',
  needs: 'none',
  flags: ['json', 'gates', 'base-branch', 'tracker', 'preset', 'packs'],
  help: `  setup [--json] [--gates CMD] [--base-branch B] [--tracker KIND] [--preset NAME] [--packs A,B]
                   Install the chosen opinion packs (default base) into .claude/, never overwriting,
                   and record them in .claude/forger.lock.json`,
  run({values, pluginRoot, installedSkills}) {
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
      result = runSetup(process.cwd(), pluginRoot, {
        packs: parsePackList(values.packs),
        gates: values.gates,
        baseBranch: values['base-branch'],
        trackerKind: values.tracker,
        skills,
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
