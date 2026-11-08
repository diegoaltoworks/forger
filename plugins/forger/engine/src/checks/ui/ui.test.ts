import {describe, expect, test} from 'bun:test';

import {parseUiConfig} from '../../ui';
import type {FileChange} from '../decisions';
import {UI_OPINION, checkUiEvidence, narrowestViewportGaps} from './ui';

const config = parseUiConfig(JSON.stringify({paths: ['src/**/*.tsx', 'public/**'], start: 's'}));
const add = (path: string): FileChange => ({path, status: 'added'});

describe('checkUiEvidence', () => {
  const table: Array<[string, FileChange[], number]> = [
    ['no UI change', [add('README.md'), add('src/server.ts')], 0],
    ['a UI change with no screenshot', [{path: 'src/App.tsx', status: 'modified'}], 1],
    ['a UI change with a new screenshot', [add('src/App.tsx'), add('docs/screenshots/index-phone-light.png')], 0],
    ['a UI change with an updated screenshot', [add('public/x.css'), {path: 'docs/screenshots/a.png', status: 'modified'}], 0],
    ['a UI change whose only screenshot change is a deletion', [add('src/App.tsx'), {path: 'docs/screenshots/a.png', status: 'deleted'}], 1],
    ['a UI change with a new capture video', [add('src/App.tsx'), add('docs/screenshots/play.webm')], 0],
    ['a UI change with an updated capture gif', [add('src/App.tsx'), {path: 'docs/screenshots/play.gif', status: 'modified'}], 0],
    ['a UI change whose only capture change is a deletion', [add('src/App.tsx'), {path: 'docs/screenshots/play.webm', status: 'deleted'}], 1],
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

describe('screenshots branch', () => {
  const branched = parseUiConfig(JSON.stringify({paths: ['src/**/*.tsx'], start: 's', screenshots_branch: 'screenshots'}));
  const ui = [add('src/App.tsx')];

  test('check ui accepts a UI change whose PR body links images on the configured screenshots branch', () => {
    const body = '## Screenshots\n![a](https://github.com/o/r/blob/screenshots/pr-1/a.png?raw=true)';
    expect(checkUiEvidence(ui, branched, body)).toEqual([]);
  });

  test('check ui fails a UI change with neither docs/screenshots changes nor a screenshots-branch link', () => {
    expect(checkUiEvidence(ui, branched, 'see https://github.com/o/r/blob/main/a.png')).toHaveLength(1);
    expect(checkUiEvidence(ui, branched, '')).toHaveLength(1);
    expect(checkUiEvidence(ui, branched, 'https://github.com/o/r/tree/screenshots/pr-1')).toHaveLength(1);
  });

  test('a link on the branch does not count when no branch is configured', () => {
    expect(checkUiEvidence(ui, config, 'https://github.com/o/r/blob/screenshots/a.png')).toHaveLength(1);
  });
});

describe('narrowestViewportGaps', () => {
  const withWidths = (...w: number[]) =>
    parseUiConfig(JSON.stringify({paths: ['a'], start: 's', viewports: w.map((x, i) => ({name: `v${i}`, width: x, height: 800}))}));

  test('check ui warns when no viewport is 360 px or narrower', () => {
    const [gap] = narrowestViewportGaps(withWidths(390, 1280));
    expect(gap).toMatchObject({opinion: 'ui.narrowest-viewport', modality: 'SHOULD'});
  });

  test('passes with a 320 px or 360 px viewport', () => {
    expect(narrowestViewportGaps(withWidths(320, 1280))).toEqual([]);
    expect(narrowestViewportGaps(withWidths(360))).toEqual([]);
  });
});
