import {describe, expect, test} from 'bun:test';

import {
  blankCodeSpans,
  checkAvoidedTerms,
  checkDiagrams,
  checkLinks,
  extractLinks,
  headingAnchors,
  mermaidProblem,
  parseGlossaryAvoid,
  resolveRepoPath,
  splitFences,
  type LinkWorld,
} from './docs-content';

const files: Record<string, string> = {
  'README.md': '# Top\n\n## Setup steps\n',
  'docs/a.md': '# A\n\n## Details\n\n## Details\n',
  'docs/img/pic.png': '',
};
const world: LinkWorld = {
  exists: p => p in files || Object.keys(files).some(k => k.startsWith(p + '/')),
  read: p => files[p] ?? null,
};
const rules = (file: string, text: string) => checkLinks(file, text, world).map(f => [f.line, f.rule]);

describe('splitFences', () => {
  test('separates fenced blocks and blanks them from prose, keeping line numbers', () => {
    const r = splitFences('a\n```mermaid\ngraph TD\n```\nb');
    expect(r.fences).toEqual([{info: 'mermaid', start: 3, body: 'graph TD'}]);
    expect(r.prose).toEqual(['a', '', '', '', 'b']);
  });
  test('a longer fence is not closed by a shorter one', () => {
    const r = splitFences('````\n```\nx\n````\ny');
    expect(r.fences[0].body).toBe('```\nx');
    expect(r.prose[4]).toBe('y');
  });
});

describe('blankCodeSpans', () => {
  test('replaces spans with spaces of equal length', () => {
    expect(blankCodeSpans('a `b c` d')).toBe('a       d');
  });
});

describe('extractLinks', () => {
  test('finds links and images with their lines and skips code', () => {
    const text = 'see [x](a.md#h "t") and ![i](p.png)\n`[no](b.md)`\n```\n[no](c.md)\n```\n[ang](<d e.md>)';
    expect(extractLinks(text)).toEqual([
      {line: 1, target: 'a.md#h', image: false},
      {line: 1, target: 'p.png', image: true},
      {line: 6, target: 'd e.md', image: false},
    ]);
  });
});

describe('headingAnchors', () => {
  test('slugs like GitHub, with duplicate suffixes and inline markup stripped', () => {
    expect(headingAnchors('# A `b` [c](d.md)\n## Details\n## Details\n### What\'s up?\n```\n# not a heading\n```')).toEqual([
      'a-b-c',
      'details',
      'details-1',
      'whats-up',
    ]);
  });
});

describe('resolveRepoPath', () => {
  test.each([
    ['docs/a.md', 'b.md', 'docs/b.md'],
    ['docs/a.md', '../README.md', 'README.md'],
    ['docs/a.md', '/README.md', 'README.md'],
    ['docs/a.md', './img/pic.png', 'docs/img/pic.png'],
    ['a.md', '../x.md', null],
  ])('%s + %s', (file, target, want) => expect(resolveRepoPath(file, target)).toBe(want));
});

describe('checkLinks', () => {
  test('resolving links and anchors pass', () => {
    expect(rules('docs/a.md', '[r](../README.md#setup-steps) [s](a.md) [top](#top)')).toEqual([]);
  });
  test('a link to a missing file is broken', () => {
    expect(rules('docs/a.md', 'x\n[gone](nope.md)')).toEqual([[2, 'broken-link']]);
  });
  test('an anchor in the same file resolves, with duplicate suffixes', () => {
    expect(rules('docs/a.md', '## Same\n## Same\n[x](#same) [y](#same-1) [z](#same-2)')).toEqual([[3, 'broken-anchor']]);
  });
  test('a link to a directory resolves', () => {
    expect(rules('README.md', '[d](docs)')).toEqual([]);
  });
  test('an anchor missing in another file is broken', () => {
    const r = checkLinks('README.md', '[x](docs/a.md#nowhere)', world);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({rule: 'broken-anchor', opinion: 'docs.links-resolve'});
    expect(r[0].detail).toContain('docs/a.md');
  });
  test('an anchor missing in the same file is broken', () => {
    expect(rules('README.md', '[x](#nowhere)')).toEqual([[1, 'broken-anchor']]);
  });
  test('a missing image is its own rule and opinion', () => {
    const r = checkLinks('docs/a.md', '![x](img/missing.png)', world);
    expect(r.map(f => [f.rule, f.opinion])).toEqual([['missing-image', 'docs.images-resolve']]);
  });
  test('an existing image passes', () => expect(rules('docs/a.md', '![x](img/pic.png)')).toEqual([]));
  test('external links and mail links are not checked', () => {
    expect(rules('README.md', `[a](https://x.example/y) [b](mailto:${'someone'}${'@'}${'host.example'}) [c](//cdn.example/z)`)).toEqual([]);
  });
  test('a link out of the repo is broken', () => expect(rules('a.md', '[x](../up.md)')).toEqual([[1, 'broken-link']]));
  test('links inside code spans and fences are ignored', () => {
    expect(rules('README.md', '`[x](nope.md)`\n```\n[y](nope.md)\n```')).toEqual([]);
  });
});

describe('mermaidProblem', () => {
  test.each([
    ['flowchart', 'graph TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C((Done))'],
    ['subgraph', 'flowchart LR\n  subgraph one\n    A --> B\n  end'],
    ['quoted brackets', 'graph TD\n  A["a (b) ]"] --> B'],
    ['sequence', 'sequenceDiagram\n  A->>B: hi :)\n  B-->>A: ok'],
    ['comments and init', '%%{init: {}}%%\n%% note\nstateDiagram-v2\n  [*] --> S'],
    ['front matter', '---\ntitle: t\n---\ngraph TD\n  A --> B'],
  ])('%s parses', (_n, code) => expect(mermaidProblem(code)).toBeNull());

  test.each([
    ['empty', '', 'empty'],
    ['unknown type', 'graf TD\n  A --> B', 'unknown diagram type'],
    ['no body', 'graph TD', 'no content'],
    ['bad direction', 'graph XX\n  A --> B', 'direction'],
    ['unclosed bracket', 'graph TD\n  A[Start --> B', 'unclosed'],
    ['unbalanced closer', 'graph TD\n  A --> B]', 'unbalanced'],
    ['unterminated quote', 'graph TD\n  A["x --> B', 'unterminated quote'],
    ['dangling arrow', 'graph TD\n  A -->', 'nothing on one side'],
    ['leading arrow', 'graph TD\n  --> B', 'nothing on one side'],
    ['unclosed subgraph', 'graph TD\n  subgraph s\n  A --> B', 'never closed'],
    ['stray end', 'graph TD\n  A --> B\n  end', 'without a subgraph'],
    ['open front matter', '---\ntitle: t\ngraph TD', 'front matter'],
  ])('%s is reported', (_n, code, part) => expect(mermaidProblem(code)).toContain(part));
});

describe('checkDiagrams', () => {
  test('reports an unparseable block at its first line and skips other languages', () => {
    const text = 'x\n```mermaid\ngraph TD\n  A -->\n```\n```ts\ngraph TD\n```\n```mermaid\ngraph TD\n  A --> B\n```';
    const r = checkDiagrams('d.md', text);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({line: 3, rule: 'bad-diagram', opinion: 'docs.diagrams-parse'});
  });
});

describe('parseGlossaryAvoid', () => {
  const glossary = [
    '**Owner**:',
    'The person.',
    '_Avoid_: user, human (when meaning the owner), client',
    '',
    '**Engine**:',
    '_Avoid_: runner, loop (when meaning the process, itself)',
    '**Pack**:',
    'no avoid list here',
  ].join('\n');
  test('lists unqualified terms with the term to use instead', () => {
    expect(parseGlossaryAvoid(glossary)).toEqual([
      {term: 'user', use: 'Owner'},
      {term: 'client', use: 'Owner'},
      {term: 'runner', use: 'Engine'},
    ]);
  });
  test('no glossary entries means no terms', () => expect(parseGlossaryAvoid('# Title\n')).toEqual([]));
});

describe('checkAvoidedTerms', () => {
  const terms = [
    {term: 'runner', use: 'Engine'},
    {term: 'plugin point', use: 'Skill slot'},
  ];
  const run = (text: string) => checkAvoidedTerms('a.md', text, terms).map(f => [f.line, f.detail]);
  test('flags a whole word in prose, any case, and names the replacement', () => {
    expect(run('ok\nThe Runner starts')).toEqual([[2, '"runner" is avoided; say "Engine"']]);
  });
  test('flags a phrase', () => expect(run('a plugin point here')).toHaveLength(1));
  test('a code span is not flagged', () => expect(run('use `runner` here')).toEqual([]));
  test('a code fence is not flagged', () => expect(run('```\nrunner\n```')).toEqual([]));
  test('compounds, plurals and paths are not flagged', () => {
    expect(run('test-runner runners runner.lock .forger/runner.ts')).toEqual([]);
  });
  test('a sentence ending in the word is flagged', () => expect(run('start the runner.')).toHaveLength(1));
  test('reports the opinion id', () => {
    expect(checkAvoidedTerms('a.md', 'runner', terms)[0].opinion).toBe('docs.glossary-terms');
  });
});
