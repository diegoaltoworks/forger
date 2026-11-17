import {describe, expect, test} from 'bun:test';

import {WRITTEN_MARKS, WRITTEN_NODES, type AdfNode} from './adf';
import {adfToMarkdown} from './adf-to-markdown';
import {markdownToAdf} from './markdown-to-adf';

const back = (md: string): string => adfToMarkdown(markdownToAdf(md));
const doc = (...content: AdfNode[]): AdfNode => ({type: 'doc', content});
const p = (...content: AdfNode[]): AdfNode => ({type: 'paragraph', content});
const t = (text: string, ...marks: string[]): AdfNode => ({type: 'text', text, ...(marks.length ? {marks: marks.map((type) => ({type}))} : {})});

const TICKET = `Part of the plan.

## What happened

Something broke, see [the log](https://example.com/log) and **why** it matters.

## What to build

- a thing
  - a nested thing
  - another \`bun test\` one

1. first
2. second

## Acceptance

- [ ] Test \`a ticket comes back\` passes
- [x] \`bun plugins/forger/bin/work.ts check docs\` exits 0
- [ ] Gates green

## Guards

\`\`\`ts
const a = "b";
\`\`\`

---

## Merge

when green`;

const sections = (md: string): string[] => md.split('\n').filter((l) => /^#{1,6} /.test(l));
const boxes = (md: string): string[] => md.split('\n').filter((l) => /^\s*- \[[ x]\] /.test(l));

describe('the ADF conversion', () => {
  test("a ticket in the engine's shape comes back from ADF with the same sections and the same criteria", () => {
    const again = back(TICKET);
    expect(sections(again)).toEqual(sections(TICKET));
    expect(boxes(again)).toEqual(boxes(TICKET));
    expect(again).toBe(TICKET);
  });

  test('a command in code font keeps every character through ADF and back', () => {
    const commands = [
      `echo "a | b" 'c' \\n $HOME *x* _y_ <z> >o [1] [ ]`,
      'grep -E "^[a-z]+$" | sort > out',
      "printf '%s\\n' `x` ``y``",
      '`leading and trailing`',
      ' spaced ',
    ];
    for (const cmd of commands) {
      const adf = markdownToAdf(`- [ ] run it\n`);
      expect(adf.content.length).toBe(1);
      const built = adfToMarkdown(doc(p(t(cmd, 'code'))));
      const parsed = markdownToAdf(built);
      expect(parsed.content[0]?.content?.[0]).toEqual({type: 'text', text: cmd, marks: [{type: 'code'}]});
      expect(adfToMarkdown(parsed)).toBe(built);
    }
  });

  test('a task item and a list item that begins [ ] or [x] are both read as a checkbox', () => {
    const task = doc({type: 'taskList', content: [{type: 'taskItem', attrs: {state: 'TODO'}, content: [t('one')]}]});
    const plain = doc({type: 'bulletList', content: [{type: 'listItem', content: [p(t('[ ] one'))]}]});
    expect(adfToMarkdown(task)).toBe('- [ ] one');
    expect(adfToMarkdown(plain)).toBe('- [ ] one');
  });

  test('a done task item is read as a checked box', () => {
    const task = doc({type: 'taskList', content: [{type: 'taskItem', attrs: {state: 'DONE'}, content: [t('done')]}]});
    expect(adfToMarkdown(task)).toBe('- [x] done');
  });

  test('a code block keeps its text and its language both ways', () => {
    const md = '```ts\nconst a = 1;\n\nconst b = "```";\n```';
    const parsed = markdownToAdf('```ts\nline 1\n\nline 3\n```');
    expect(parsed.content[0]).toEqual({type: 'codeBlock', attrs: {language: 'ts'}, content: [{type: 'text', text: 'line 1\n\nline 3'}]});
    expect(adfToMarkdown(parsed)).toBe('```ts\nline 1\n\nline 3\n```');
    const fromAdf = adfToMarkdown(doc({type: 'codeBlock', attrs: {language: 'ts'}, content: [t('const b = "```";')]}));
    expect(markdownToAdf(fromAdf).content[0]?.content?.[0]?.text).toBe('const b = "```";');
    expect(md).toContain('```ts');
  });

  test('nested lists keep their depth both ways', () => {
    const md = '- a\n  - b\n    - c\n  - d\n- e\n\n1. one\n   1. inner\n2. two';
    expect(back(md)).toBe(md);
    const first = markdownToAdf(md).content[0];
    expect(first?.content?.[0]?.content?.[1]?.type).toBe('bulletList');
  });

  test('a link, strong and emphasised text convert both ways', () => {
    const md = 'a [site](https://x.test/a?b=c) and **bold** and *soft* and [**both**](u)';
    expect(back(md)).toBe(md);
    const nodes = markdownToAdf(md).content[0]?.content ?? [];
    expect(nodes.find((n) => n.text === 'bold')?.marks).toEqual([{type: 'strong'}]);
    expect(nodes.find((n) => n.text === 'soft')?.marks).toEqual([{type: 'em'}]);
    expect(nodes.find((n) => n.text === 'site')?.marks).toEqual([{type: 'link', attrs: {href: 'https://x.test/a?b=c'}}]);
    expect(adfToMarkdown(doc(p(t('x', 'strong', 'em'))))).toBe('***x***');
  });

  test('a line break inside a paragraph is a hard break both ways', () => {
    const parsed = markdownToAdf('one\ntwo');
    expect(parsed.content[0]?.content?.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(adfToMarkdown(parsed)).toBe('one\ntwo');
    expect(adfToMarkdown(doc(p(t('a'), {type: 'hardBreak'}, t('b'))))).toBe('a\nb');
  });

  test('a node the conversion does not know keeps its text', () => {
    const mention: AdfNode = {type: 'mention', attrs: {id: '1', text: '@Ann'}};
    const emoji: AdfNode = {type: 'emoji', attrs: {shortName: ':smile:'}};
    const panel: AdfNode = {type: 'panel', content: [p(t('inside panel'))]};
    const table: AdfNode = {
      type: 'table',
      content: [{type: 'tableRow', content: [{type: 'tableCell', content: [p(t('cell one'))]}, {type: 'tableCell', content: [p(t('cell two'))]}]}],
    };
    const media: AdfNode = {type: 'mediaSingle', content: [{type: 'media', attrs: {id: 'x'}}]};
    const out = adfToMarkdown(doc(p(t('hi '), mention, t(' '), emoji), panel, table, media));
    expect(out).toContain('hi @Ann :smile:');
    expect(out).toContain('inside panel');
    expect(out).toContain('cell one');
    expect(out).toContain('cell two');
  });

  test('markdown with no node of its own comes back unchanged', () => {
    for (const md of ['| a | b |\n| - | - |\n| 1 | 2 |', '> quoted\n> lines', '<div class="x">raw</div>']) {
      expect(back(md)).toBe(md);
      expect(markdownToAdf(md).content.every((n) => n.type === 'paragraph')).toBe(true);
    }
  });

  test('the document written has version 1 and only the nodes the conversion reads', () => {
    const adf = markdownToAdf(TICKET);
    expect(adf.version).toBe(1);
    const nodes = new Set<string>();
    const marks = new Set<string>();
    const walk = (n: AdfNode): void => {
      nodes.add(n.type);
      for (const m of n.marks ?? []) marks.add(m.type);
      n.content?.forEach(walk);
    };
    walk(adf);
    for (const type of nodes) expect(WRITTEN_NODES as readonly string[]).toContain(type);
    for (const type of marks) expect(WRITTEN_MARKS as readonly string[]).toContain(type);
  });
});
