import {describe, expect, test} from 'bun:test';

import {folderOfPath, placementFolders, placementProblems, placementWarnings} from './placement';

const ctx = {frozen: ['src/old'], overLimit: ['src/big'], structureTickets: [9], blockedBy: []};

describe('placement', () => {
  test.each([
    ['src/a/b.ts', 'src/a'],
    ['src/a/', 'src/a'],
    ['src/a', 'src/a'],
    ['file.ts', '.'],
  ])('folderOfPath %s', (path, folder) => expect(folderOfPath(path)).toBe(folder));

  test('reads backticked paths; none is empty; absent is null', () => {
    expect(placementFolders('## Placement\n\n`src/a/x.ts` and `src/b/`\n')).toEqual(['src/a', 'src/b']);
    expect(placementFolders('## Placement\n\nnone\n')).toEqual([]);
    expect(placementFolders('## Guards\nnone')).toBeNull();
    expect(placementWarnings('## Guards\nnone')).toHaveLength(1);
  });

  test('an unflagged folder passes', () => {
    expect(placementProblems('## Placement\n\n`src/fine/x.ts`', ctx)).toEqual([]);
  });

  test('a flagged folder names the folder, the rule and both ways forward', () => {
    const [p] = placementProblems('## Placement\n\n`src/big/x.ts`', ctx);
    expect(p).toContain('src/big');
    expect(p).toContain('structure.folder-size');
    expect(p).toContain('move files out');
    expect(p).toContain('labelled structure');
  });

  test('a blocker that is not a structure ticket does not clear it', () => {
    expect(placementProblems('## Placement\n\n`src/big/x.ts`\n\n## Blocked by\n\n#4', ctx)).toHaveLength(1);
  });

  test('a move that names another folder does not clear it', () => {
    expect(placementProblems('## What to build\n\nMove a.ts out of src/other.\n\n## Placement\n\n`src/big/x.ts`', ctx)).toHaveLength(1);
  });
});
