import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {DOCS_OPINIONS} from './docs-content';
import {installedPackIds, runDocsCheck} from './docs-check';
import {loadPacks} from '../../packs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-docs-'));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  return root;
}

const lister = (names: string[]) => () => names.join('\n');

describe('runDocsCheck', () => {
  test('flags a model name in a doc, using the configured list', () => {
    const root = repo({'a.md': 'ask the Sonnet model\n', 'b.md': 'ask the Mixtral model\n'});
    expect(runDocsCheck(root, lister(['a.md', 'b.md'])).map(v => `${v.file}:${v.rule}`)).toEqual(['a.md:model-agnostic']);
  });

  test('the configured list replaces the default', () => {
    const root = repo({
      'a.md': 'ask the Sonnet model\nask the Mixtral model\n',
      '.claude/workloop.config.json': JSON.stringify({model_names: ['mixtral']}),
    });
    expect(runDocsCheck(root, lister(['a.md'])).map(v => v.line)).toEqual([2]);
  });

  test('clean tree has no violations', () => {
    const root = repo({'a.md': 'plain text\n'});
    expect(runDocsCheck(root, lister(['a.md']))).toEqual([]);
  });

  test('scans only the files git lists', () => {
    const root = repo({'a.md': 'ok', 'ignored.md': 'bad \u2014'});
    expect(runDocsCheck(root, lister(['a.md']))).toEqual([]);
  });

  test('scans a new file before it is committed', () => {
    const root = repo({'a.md': 'ok', 'new.md': 'bad \u2014'});
    const run = (cmd: string) => (cmd === 'git ls-files --others --exclude-standard' ? 'new.md' : 'a.md');
    expect(runDocsCheck(root, run).map(v => `${v.file}:${v.rule}`)).toEqual(['new.md:non-ascii']);
  });

  test('fails a raw gh pr merge in a command file, and only there', () => {
    const merge = 'gh pr merge --squash --delete-branch\n';
    const root = repo({'commands/ship.md': merge, '.claude/commands/ship.md': merge, 'docs/notes.md': merge});
    const v = runDocsCheck(root, lister(['commands/ship.md', '.claude/commands/ship.md', 'docs/notes.md']));
    expect(v.map(x => `${x.file}:${x.line}:${x.rule}:${x.opinion}`)).toEqual([
      'commands/ship.md:1:raw-merge:base.merge-through-tool',
      '.claude/commands/ship.md:1:raw-merge:base.merge-through-tool',
    ]);
  });

  test('reads the denylist when present', () => {
    const root = repo({'a.md': 'about Acme', '.forger-denylist': 'acme\n'});
    const v = runDocsCheck(root, lister(['a.md']));
    expect(v.map(x => [x.line, x.rule])).toEqual([[1, 'denylist']]);
  });

  test('absent denylist is not an error', () => {
    const root = repo({'a.md': 'about Acme'});
    expect(runDocsCheck(root, lister(['a.md']))).toEqual([]);
  });

  test('skips lockfiles and binary files', () => {
    const root = repo({'bun.lock': 'x \u2014', 'img.bin': 'a\0\u2014'});
    expect(runDocsCheck(root, lister(['bun.lock', 'img.bin']))).toEqual([]);
  });
});

describe('docs pack content rules', () => {
  const glossary = '**Engine**:\nThe process.\n_Avoid_: runner\n';
  const broken = [
    '# T',
    '[gone](nope.md)',
    '[bad](#nowhere)',
    '![i](img/none.png)',
    '```mermaid',
    'graph TD',
    '  A -->',
    '```',
    'the runner starts and `runner` is code',
  ].join('\n');
  const tree = {'GLOSSARY.md': glossary, 'a.md': broken};

  test('run every rule with its own opinion when the pack is installed', () => {
    const v = runDocsCheck(repo(tree), lister(['GLOSSARY.md', 'a.md']), ['base', 'docs']);
    expect(v.map(x => [x.file, x.line, x.opinion])).toEqual([
      ['a.md', 2, 'docs.links-resolve'],
      ['a.md', 3, 'docs.links-resolve'],
      ['a.md', 4, 'docs.images-resolve'],
      ['a.md', 6, 'docs.diagrams-parse'],
      ['a.md', 9, 'docs.glossary-terms'],
    ]);
  });

  test('stay off when the pack is not installed', () => {
    expect(runDocsCheck(repo(tree), lister(['GLOSSARY.md', 'a.md']), ['base'])).toEqual([]);
  });

  test('do not read non-Markdown files as docs', () => {
    expect(runDocsCheck(repo({'a.txt': '[gone](nope.md) runner', 'GLOSSARY.md': glossary}), lister(['a.txt']), ['docs'])).toEqual([]);
  });

  test('the glossary may name the words it avoids', () => {
    expect(runDocsCheck(repo({'GLOSSARY.md': glossary}), lister(['GLOSSARY.md']), ['docs'])).toEqual([]);
  });

  test('resolve a link to a file the repo has', () => {
    const root = repo({'a.md': '[b](docs/b.md#h) ![i](img/p.png)', 'docs/b.md': '# H\n', 'img/p.png': ''});
    expect(runDocsCheck(root, lister(['a.md', 'docs/b.md']), ['docs'])).toEqual([]);
  });
});

describe('installedPackIds', () => {
  test('reads the ids from the lock', () => {
    const root = repo({'.claude/forger.lock.json': JSON.stringify({packs: [{id: 'base', version: '1.0.0', files: []}]})});
    expect(installedPackIds(root)).toEqual(['base']);
  });
  test('no lock means no packs', () => expect(installedPackIds(repo({}))).toEqual([]));
});

describe('the shipped docs pack', () => {
  test('declares an opinion for every rule id the content rules emit', () => {
    const pack = loadPacks(join(import.meta.dir, '..', '..', '..', '..')).find(p => p.manifest.id === 'docs');
    const declared = pack!.manifest.opinions.filter(o => o.check === 'docs').map(o => o.id);
    expect(declared.sort()).toEqual([...new Set(Object.values(DOCS_OPINIONS))].sort());
  });
});
