import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {LOCK_PATH, detectPacks, formatOpinions, formatSuggestions, readRepoFacts, formatPacks, listOpinions, listPacks, loadPacks, parseLock} from '../packs';
import type {Command, CommandContext} from './command';
import {forgerPath} from '../config';

function installed(which: 'packs' | 'opinions') {
  return ({values, projectRoot, pluginRoot}: CommandContext): void => {
    const lockPath = forgerPath(projectRoot, LOCK_PATH);
    let out;
    try {
      const lock = existsSync(lockPath) ? parseLock(readFileSync(lockPath, 'utf-8')) : {packs: []};
      const available = loadPacks(pluginRoot);
      if (which === 'packs' && values.detect) {
        const suggested = detectPacks(available, lock, readRepoFacts(projectRoot));
        console.log(values.json ? JSON.stringify(suggested) : formatSuggestions(suggested));
        return;
      }
      out = which === 'packs' ? listPacks(available, lock) : listOpinions(available, lock);
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
      return;
    }
    if (values.json) console.log(JSON.stringify(out));
    else console.log(which === 'packs' ? formatPacks(out as ReturnType<typeof listPacks>) : formatOpinions(out as ReturnType<typeof listOpinions>));
  };
}

export const packs: Command = {
  name: 'packs',
  needs: 'root',
  flags: ['json', 'detect'],
  help: `  packs [--json] [--detect]
                   Available packs and which are installed; --detect suggests packs from repo facts`,
  run: installed('packs'),
};

export const opinions: Command = {
  name: 'opinions',
  needs: 'root',
  flags: ['json'],
  help: '  opinions [--json] Every installed opinion with its pack, rung and enforcing check',
  run: installed('opinions'),
};
