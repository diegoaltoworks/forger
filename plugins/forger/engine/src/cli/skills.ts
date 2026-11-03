import {formatSkills, loadPresets, offerPresets, resolveSkills} from '../packs';
import type {Command} from './command';

export const skills: Command = {
  name: 'skills',
  needs: 'config',
  flags: ['json', 'presets'],
  help: `  skills [--json] [--presets]
                   Resolve each skill slot to its configured skill and the built-in fallback;
                   --presets lists the presets whose skill collection is installed`,
  run({values, config, pluginRoot, installedSkills, collectionRoots}) {
    const installed = installedSkills();
    const presets = loadPresets(pluginRoot);
    const out = values.presets ? offerPresets(presets, installed) : resolveSkills(config.skills, installed, {roots: [...collectionRoots(), pluginRoot], presets});
    if (values.json) console.log(JSON.stringify(out));
    else if (values.presets) console.log((out as ReturnType<typeof offerPresets>).map(p => `${p.name}: ${p.description}`).join('\n') || 'no preset matches an installed skill collection');
    else console.log(formatSkills(out as ReturnType<typeof resolveSkills>));
  },
};
