import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {LOCK_PATH, formatOpinions, formatPacks, listOpinions, listPacks, loadPacks, parseLock} from '../packs';
import type {Command, CommandContext} from './command';

function installed(which: 'packs' | 'opinions') {
  return ({values, projectRoot, pluginRoot}: CommandContext): void => {
    const lockPath = join(projectRoot, LOCK_PATH);
    let out;
    try {
      const lock = existsSync(lockPath) ? parseLock(readFileSync(lockPath, 'utf-8')) : {packs: []};
      const available = loadPacks(pluginRoot);
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
  flags: ['json'],
  help: '  packs [--json]   Available packs and which are installed',
  run: installed('packs'),
};

export const opinions: Command = {
  name: 'opinions',
  needs: 'root',
  flags: ['json'],
  help: '  opinions [--json] Every installed opinion with its pack, rung and enforcing check',
  run: installed('opinions'),
};
