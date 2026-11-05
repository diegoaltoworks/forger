import {describe, expect, test} from 'bun:test';

import {briefFrom, buildCritiqueInput, isVisualChange, splitFindings, ticketFor, type Finding} from './critique';

const f = (severity: Finding['severity'], title: string = severity): Finding => ({severity, dimension: 'feel', title, body: 'body', evidence: 'docs/screenshots/a.png'});

describe('isVisualChange', () => {
  test('a ui path counts', () => expect(isVisualChange(['src/ui/App.tsx'], ['src/ui/**'])).toBe(true));
  test('an updated capture counts without any ui path', () => expect(isVisualChange(['docs/screenshots/home.png'], [])).toBe(true));
  test('engine code does not', () => expect(isVisualChange(['src/engine.ts', 'README.md'], ['src/ui/**'])).toBe(false));
});

describe('splitFindings', () => {
  const all = [f('high'), f('medium'), f('low')];
  test('files what is at or above the threshold and reports the rest', () => {
    const r = splitFindings(all, 'medium');
    expect(r.file.map(x => x.severity)).toEqual(['high', 'medium']);
    expect(r.report.map(x => x.severity)).toEqual(['low']);
  });
  test('a high threshold files only the worst', () => expect(splitFindings(all, 'high').file).toHaveLength(1));
  test('a low threshold files everything', () => expect(splitFindings(all, 'low').report).toHaveLength(0));
});

describe('briefFrom', () => {
  const doc = '# Plan\n\n## Brief, verbatim\n\nAn 8-bit demo.\nMake it playful.\n\n## Interpretation of references\n\nRead for charm.\n\n## Goal\n\nx\n';
  test('reads the brief and the references, verbatim', () => {
    expect(briefFrom(doc)).toEqual({brief: 'An 8-bit demo.\nMake it playful.', references: 'Read for charm.'});
  });
  test('a doc with no brief section holds none', () => expect(briefFrom('# Plan\n\n## Goal\n\nx')).toBeNull());
  test("the template's placeholder is not a brief", () => {
    expect(briefFrom('## Brief, verbatim\n\n<The owner\'s words, unedited.>\n\n## Goal\n')).toBeNull();
  });
  test('references are optional', () => expect(briefFrom('## Brief, verbatim\n\nwords\n')).toEqual({brief: 'words', references: null}));
});

describe('ticketFor', () => {
  test('keeps the title and cites the PR, dimension and evidence', () => {
    const t = ticketFor(f('high', ' Hero needs a face ' as string), 12);
    expect(t.title).toBe('Hero needs a face');
    expect(t.body).toContain('body');
    expect(t.body).toContain('PR #12');
    expect(t.body).toContain('docs/screenshots/a.png');
  });
});

describe('buildCritiqueInput', () => {
  test('holds the brief, the captures and the suffix, and shows earlier problems', () => {
    const input = buildCritiqueInput({brief: {brief: 'B', references: 'R'}, captures: ['docs/screenshots/a.png'], suffix: 'SUFFIX', problems: ['bad score']});
    for (const part of ['## Brief, verbatim\nB', '## Interpretation of references\nR', '- docs/screenshots/a.png', '- bad score', 'SUFFIX']) expect(input).toContain(part);
  });
  test('leaves out the references and problems when there are none', () => {
    const input = buildCritiqueInput({brief: {brief: 'B', references: null}, captures: [], suffix: 'S'});
    expect(input).not.toContain('Interpretation');
    expect(input).not.toContain('previous answer');
  });
});
