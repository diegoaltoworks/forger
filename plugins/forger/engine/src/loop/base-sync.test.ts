import {describe, expect, test} from 'bun:test';

import {behindBaseAnomaly, behindBaseRefusal, readBaseSync} from './base-sync';

const fakeGit = (behind: string, status: string) => (cmd: string): string => {
  if (cmd.startsWith('git rev-list')) return behind;
  if (cmd.startsWith('git status')) return status;
  return '';
};

describe('base sync', () => {
  test('reads the behind count and cleanliness through git', () => {
    expect(readBaseSync(fakeGit('3\n', ''), 'main')).toEqual({behind: 3, clean: true});
    expect(readBaseSync(fakeGit('0', ' M a.ts'), 'main')).toEqual({behind: 0, clean: false});
  });
  test('a failing git leaves the count unknown', () => {
    const boom = (): string => {
      throw new Error('offline');
    };
    expect(readBaseSync(boom, 'main')).toEqual({behind: null, clean: false});
  });
  test('orient reports a behind base only while no engine is alive', () => {
    const sync = {behind: 2, clean: false};
    expect(behindBaseAnomaly(sync, 'main', false)).toContain('git pull --ff-only origin main');
    expect(behindBaseAnomaly(sync, 'main', true)).toBeNull();
    expect(behindBaseAnomaly({behind: 0, clean: true}, 'main', false)).toBeNull();
    expect(behindBaseAnomaly(undefined, 'main', false)).toBeNull();
  });
  test('run refuses a behind base in a clean checkout and names the fix', () => {
    expect(behindBaseRefusal({behind: 2, clean: true}, 'main')).toContain('git pull --ff-only origin main');
    expect(behindBaseRefusal({behind: 2, clean: false}, 'main')).toBeNull();
    expect(behindBaseRefusal({behind: null, clean: true}, 'main')).toBeNull();
  });
});
