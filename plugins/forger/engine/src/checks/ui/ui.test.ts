import {describe, expect, test} from 'bun:test';

import {parseUiConfig} from '../../ui';
import type {FileChange} from '../decisions';
import {UI_OPINION, checkUiEvidence} from './ui';

const config = parseUiConfig(JSON.stringify({paths: ['src/**/*.tsx', 'public/**'], start: 's'}));
const add = (path: string): FileChange => ({path, status: 'added'});

describe('checkUiEvidence', () => {
  const table: Array<[string, FileChange[], number]> = [
    ['no UI change', [add('README.md'), add('src/server.ts')], 0],
    ['a UI change with no screenshot', [{path: 'src/App.tsx', status: 'modified'}], 1],
    ['a UI change with a new screenshot', [add('src/App.tsx'), add('docs/screenshots/index-phone-light.png')], 0],
    ['a UI change with an updated screenshot', [add('public/x.css'), {path: 'docs/screenshots/a.png', status: 'modified'}], 0],
    ['a UI change whose only screenshot change is a deletion', [add('src/App.tsx'), {path: 'docs/screenshots/a.png', status: 'deleted'}], 1],
    ['a screenshot alone is not a UI change', [add('docs/screenshots/a.png')], 0],
    ['a deleted UI file still needs evidence', [{path: 'src/Old.tsx', status: 'deleted'}], 1],
  ];
  for (const [name, changes, count] of table) test(name, () => expect(checkUiEvidence(changes, config)).toHaveLength(count));

  test('names the opinion and the first UI file', () => {
    const [f] = checkUiEvidence([add('src/a/B.tsx'), add('src/C.tsx')], config);
    expect(f).toMatchObject({file: 'src/a/B.tsx', opinion: UI_OPINION, rule: 'ui-without-screenshots'});
  });

  test('screenshots under a UI glob do not count as UI changes', () => {
    const wide = parseUiConfig(JSON.stringify({paths: ['**/*.png'], start: 's'}));
    expect(checkUiEvidence([add('docs/screenshots/a.png')], wide)).toEqual([]);
  });
});
