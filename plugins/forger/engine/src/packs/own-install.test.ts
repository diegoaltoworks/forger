import {describe, expect, test} from 'bun:test';
import {existsSync, readdirSync, readFileSync, statSync} from 'fs';
import {join, resolve} from 'path';

import {loadPacks, LOCK_PATH, parseLock} from './packs';

const repo = resolve(import.meta.dir, '../../../../..');
const FIX = 'run `bun plugins/forger/bin/work.ts setup --upgrade` and resolve what it reports';

function leftovers(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...leftovers(p));
    else if (name.endsWith('.upstream')) out.push(p.slice(repo.length + 1));
  }
  return out;
}

describe("this repository's own install", () => {
  test("this repository's lock holds every installed pack at the plugin's version", () => {
    const lock = parseLock(readFileSync(join(repo, LOCK_PATH), 'utf8'));
    const available = new Map(loadPacks(join(repo, 'plugins/forger')).map(p => [p.manifest.id, p.manifest.version]));
    const behind = lock.packs
      .filter(p => available.get(p.id) !== p.version)
      .map(p => `${p.id} ${p.version} (plugin: ${available.get(p.id) ?? 'missing'})`);
    expect(behind, `forger's own install is behind its packs: ${FIX}`).toEqual([]);
  });

  test('no upstream file waits under .forger', () => {
    const dir = join(repo, '.forger');
    const left = existsSync(dir) ? leftovers(dir) : [];
    expect(left, `an unresolved upgrade conflict is left: resolve it by hand and delete the .upstream file, or ${FIX}`).toEqual([]);
  });
});
