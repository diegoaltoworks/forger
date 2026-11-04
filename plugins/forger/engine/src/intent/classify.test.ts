import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {classifyIntent} from './classify';

const table: Array<{name: string; request: string; dependencies?: string[]; intent: 'product' | 'creative'; ids: string[]}> = [
  {name: 'a plain feature', request: 'Add CSV export to the reports page', intent: 'product', ids: []},
  {name: 'an opinion that says think', request: 'I think Postgres suits this better', intent: 'product', ids: []},
  {name: 'game and pitch', request: 'A game for the pitch', intent: 'creative', ids: ['game', 'pitch']},
  {name: 'a demo', request: 'Make a demo of the editor', intent: 'creative', ids: ['demo']},
  {name: 'playful', request: 'Keep the onboarding playful', intent: 'creative', ids: ['playful']},
  {name: 'a style reference', request: 'Redo the landing page in the style of a travel poster', intent: 'creative', ids: ['style-of']},
  {name: 'a think reference', request: 'An intro screen. Think "a famous handheld RPG"', intent: 'creative', ids: ['think-reference']},
  {name: 'a think reference in angle brackets', request: 'Think <a famous handheld game>', intent: 'creative', ids: ['game', 'think-reference']},
  {name: 'animation', request: 'Animate the logo on load', intent: 'creative', ids: ['animation']},
  {name: 'pixel art', request: 'Use 8-bit sprites for the icons', intent: 'creative', ids: ['pixel-art']},
  {name: 'one canvas dependency alone', request: 'Add a revenue chart', dependencies: ['canvas', 'react'], intent: 'product', ids: ['dependency']},
  {name: 'two game dependencies', request: 'Add a revenue chart', dependencies: ['phaser', 'howler'], intent: 'creative', ids: ['dependency', 'dependency']},
  {name: 'a scoped game dependency counts', request: 'Add a chart', dependencies: ['@pixi/sprite', 'pixi.js'], intent: 'product', ids: ['dependency']},
];

describe('classifyIntent', () => {
  for (const row of table) {
    test(row.name, () => {
      const result = classifyIntent({request: row.request, dependencies: row.dependencies ?? []});
      expect(result.intent).toBe(row.intent);
      expect(result.signals.map(s => s.id)).toEqual(row.ids);
    });
  }

  test('each signal names its source and the text that matched', () => {
    const result = classifyIntent({request: 'A playful demo', dependencies: ['phaser']});
    expect(result.signals).toEqual([
      {id: 'demo', source: 'request', match: 'demo'},
      {id: 'playful', source: 'request', match: 'playful'},
      {id: 'dependency', source: 'repo', match: 'phaser'},
    ]);
  });

  test('the sample creative brief is creative', () => {
    const brief = readFileSync(join(import.meta.dir, 'fixtures', 'creative-brief.md'), 'utf8');
    const result = classifyIntent({request: brief, dependencies: []});
    expect(result.intent).toBe('creative');
    expect(result.signals.map(s => s.id)).toContain('think-reference');
  });
});

describe('the plan doc template', () => {
  test('carries the brief and the interpretation of references', () => {
    const template = readFileSync(join(import.meta.dir, '..', '..', '..', 'templates', 'plan-doc.md'), 'utf8');
    expect(template).toContain('## Brief, verbatim');
    expect(template).toContain('## Interpretation of references');
  });
});
