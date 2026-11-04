import {forgerPath, type SkillMapping} from '../config';
import {flavourMapping, loadFlavour, NO_TICKET} from '../pipeline';
import {formatSkills, loadPresets, offerPresets, resolveSkills} from '../packs';
import type {Command} from './command';

export const skills: Command = {
  name: 'skills',
  needs: 'config',
  flags: ['json', 'presets'],
  help: `  skills [--json] [--presets]
                   Resolve each skill slot to its skills-map entry, else the config's flavour (for a
                   ticket with no labels and no paths), else the built-in fallback;
                   --presets lists the presets whose skill collection is installed`,
  run({values, config, pluginRoot, projectRoot, installedSkills, collectionRoots}) {
    const installed = installedSkills();
    const env = {roots: [...collectionRoots(), pluginRoot]};
    const presets = loadPresets(pluginRoot);
    const flavourSkills = (): Record<string, SkillMapping> => {
      try {
        return flavourMapping(loadFlavour(pluginRoot, forgerPath(projectRoot, '.forger'), config.flavour), NO_TICKET, installed, env);
      } catch (e) {
        console.error(`skills: ${(e as Error).message}; using the built-in steps`);
        return {};
      }
    };
    const out = values.presets ? offerPresets(presets, installed) : resolveSkills({...flavourSkills(), ...config.skills}, installed, {...env, presets});
    if (values.json) console.log(JSON.stringify(out));
    else if (values.presets) console.log((out as ReturnType<typeof offerPresets>).map(p => `${p.name}: ${p.description}`).join('\n') || 'no preset matches an installed skill collection');
    else console.log(formatSkills(out as ReturnType<typeof resolveSkills>));
  },
};
