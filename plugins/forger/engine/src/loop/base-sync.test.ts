import {describe, expect, test} from 'bun:test';

import {behindBaseAnomaly, fastForwardRefusal, onlyRuntimeChanges, planBaseSync, readBaseSync, touchesPlugin} from './base-sync';

const fakeGit = (behind: string, status: string, branch = 'main') => (cmd: string): string => {
  if (cmd.startsWith('git branch')) return branch;
  if (cmd.startsWith('git rev-list')) return behind;
  if (cmd.startsWith('git status')) return status;
  return '';
};

describe('base sync', () => {
  test('reads the behind count and cleanliness through git', () => {
    expect(readBaseSync(fakeGit('3\n', ''), 'main')).toEqual({behind: 3, clean: true, onBase: true, changed: []});
    expect(readBaseSync(fakeGit('0', ' M a.ts'), 'main')).toEqual({behind: 0, clean: false, onBase: true, changed: ['a.ts']});
  });
  test('a failing git leaves the count unknown', () => {
    const boom = (): string => {
      throw new Error('offline');
    };
    expect(readBaseSync(boom, 'main')).toEqual({behind: null, clean: false, onBase: false, changed: []});
  });
  test('orient reports a behind base only while no engine is alive', () => {
    const sync = {behind: 2, clean: true, onBase: true, changed: []};
    expect(behindBaseAnomaly(sync, 'main', false)).toContain('fast-forwards it');
    expect(behindBaseAnomaly(sync, 'main', true)).toBeNull();
    expect(behindBaseAnomaly({behind: 0, clean: true, onBase: true, changed: []}, 'main', false)).toBeNull();
    expect(behindBaseAnomaly(undefined, 'main', false)).toBeNull();
  });
  test('runtime files do not count as changes', () => {
    const runtime = ['.forger/state.json', '.forger/output/'];
    expect(onlyRuntimeChanges(' M .forger/state.json\n?? .forger/output/a.log\n', runtime)).toBe(true);
    expect(onlyRuntimeChanges(' M .forger/state.json\n M src/a.ts\n', runtime)).toBe(false);
    expect(readBaseSync(fakeGit('1', ' M .forger/state.json'), 'main', runtime).clean).toBe(true);
  });
  test('the plan fast-forwards only on the base branch, clean, with no engine alive', () => {
    const sync = {behind: 2, clean: true, onBase: true, changed: []};
    expect(planBaseSync(sync, false)).toBe('fast-forward');
    expect(planBaseSync(sync, true)).toBe('none');
    expect(planBaseSync({...sync, clean: false}, false)).toBe('none');
    expect(planBaseSync({...sync, onBase: false}, false)).toBe('none');
    expect(planBaseSync({...sync, behind: 0}, false)).toBe('none');
    expect(planBaseSync({...sync, behind: null}, false)).toBe('none');
  });
  test('the refusal carries git\'s reason', () => {
    expect(fastForwardRefusal('main', 'fatal: Not possible to fast-forward\n')).toContain('fatal: Not possible to fast-forward');
  });
  test('a change under the plugin folder is told from one outside it', () => {
    expect(touchesPlugin('docs/a.md\nplugins/forger/bin/work.ts\n', 'plugins/forger')).toBe(true);
    expect(touchesPlugin('docs/a.md\nplugins/forger-x/a.ts\n', 'plugins/forger')).toBe(false);
    expect(touchesPlugin('plugins/forger/a.ts', '../cache/forger')).toBe(false);
    expect(touchesPlugin('a.ts', '')).toBe(false);
  });
});
