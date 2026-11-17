import type {AdfDoc, AdfMark, AdfNode} from './adf';

const ITEM = /^(\s*)([-*+]|\d+[.)])\s(.*)$/;
const FENCE = /^(`{3,})([^`]*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

const indentOf = (line: string): number => (/^\s*/.exec(line) ?? [''])[0].length;
const isBlank = (line: string): boolean => line.trim() === '';
const isItem = (line: string): boolean => ITEM.test(line) && !RULE.test(line);
const startsBlock = (line: string): boolean => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || isItem(line);

function text(value: string, marks: AdfMark[]): AdfNode {
  return marks.length > 0 ? {type: 'text', text: value, marks} : {type: 'text', text: value};
}

function codeEnd(s: string, from: number, run: number): number {
  let j = from;
  while (j < s.length) {
    if (s[j] !== '`') {
      j++;
      continue;
    }
    let m = 0;
    while (s[j + m] === '`') m++;
    if (m === run) return j;
    j += m;
  }
  return -1;
}

function inline(s: string, marks: AdfMark[] = []): AdfNode[] {
  const out: AdfNode[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') out.push(text(buf, marks));
    buf = '';
  };
  const wrap = (inner: string, mark: AdfMark): void => {
    flush();
    out.push(...inline(inner, [...marks, mark]));
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i] ?? '';
    if (c === '`') {
      let run = 0;
      while (s[i + run] === '`') run++;
      const end = codeEnd(s, i + run, run);
      if (end < 0) {
        buf += '`'.repeat(run);
        i += run;
        continue;
      }
      let code = s.slice(i + run, end);
      if (code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
      flush();
      out.push(text(code, [...marks, {type: 'code'}]));
      i = end + run;
      continue;
    }
    if (c === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      const inner = end < 0 ? '' : s.slice(i + 2, end);
      if (inner !== '' && inner.trim() === inner) {
        wrap(inner, {type: 'strong'});
        i = end + 2;
        continue;
      }
    } else if (c === '*' && s[i + 1] !== undefined && s[i + 1] !== ' ') {
      let end = i + 1;
      while (end < s.length && !(s[end] === '*' && s[end - 1] !== ' ' && s[end + 1] !== '*')) end++;
      const inner = s.slice(i + 1, end);
      if (end < s.length && inner !== '' && !inner.includes('*')) {
        wrap(inner, {type: 'em'});
        i = end + 1;
        continue;
      }
    } else if (c === '[') {
      const close = s.indexOf('](', i + 1);
      const end = close < 0 ? -1 : s.indexOf(')', close + 2);
      const inner = close < 0 ? '' : s.slice(i + 1, close);
      if (end >= 0 && inner !== '' && !/[[\]]/.test(inner)) {
        wrap(inner, {type: 'link', attrs: {href: s.slice(close + 2, end)}});
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function lines(rows: string[]): AdfNode[] {
  const out: AdfNode[] = [];
  rows.forEach((row, i) => {
    if (i > 0) out.push({type: 'hardBreak'});
    out.push(...inline(row));
  });
  return out;
}

function paragraph(rows: string[]): AdfNode {
  const content = lines(rows);
  return content.length > 0 ? {type: 'paragraph', content} : {type: 'paragraph'};
}

function itemBody(first: string, children: string[]): AdfNode[] {
  const body: AdfNode[] = [paragraph([first])];
  const margin = children.length === 0 ? 0 : Math.min(...children.map(indentOf));
  const rows = children.map((row) => row.slice(margin));
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] ?? '';
    if (isItem(row)) {
      let end = i + 1;
      while (end < rows.length && (isItem(rows[end] ?? '') || indentOf(rows[end] ?? '') > 0)) end++;
      body.push(...list(rows.slice(i, end)));
      i = end;
      continue;
    }
    const last = body[body.length - 1];
    if (last?.type === 'paragraph') {
      last.content = [...(last.content ?? []), {type: 'hardBreak'}, ...inline(row)];
    } else {
      body.push(paragraph([row]));
    }
    i++;
  }
  return body;
}

/** The lists of consecutive item rows: a change of marker kind at the same depth starts a new list. */
function list(rows: string[]): AdfNode[] {
  const base = indentOf(rows[0] ?? '');
  const out: AdfNode[] = [];
  let current: AdfNode | undefined;
  let i = 0;
  while (i < rows.length) {
    const match = ITEM.exec(rows[i] ?? '');
    let end = i + 1;
    while (end < rows.length && indentOf(rows[end] ?? '') > base) end++;
    if (match) {
      const ordered = /\d/.test(match[2] ?? '');
      const type = ordered ? 'orderedList' : 'bulletList';
      if (current?.type !== type) {
        current = {type, content: []};
        out.push(current);
      }
      current.content?.push({type: 'listItem', content: itemBody(match[3] ?? '', rows.slice(i + 1, end))});
    }
    i = end;
  }
  return out;
}

function blocks(rows: string[]): AdfNode[] {
  const out: AdfNode[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] ?? '';
    if (isBlank(row)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(row);
    if (fence) {
      const ticks = fence[1] ?? '```';
      const language = (fence[2] ?? '').trim();
      const body: string[] = [];
      i++;
      while (i < rows.length && !new RegExp(`^\`{${ticks.length},}\\s*$`).test(rows[i] ?? '')) body.push(rows[i++] ?? '');
      i++;
      const node: AdfNode = {type: 'codeBlock'};
      if (language !== '') node.attrs = {language};
      if (body.length > 0) node.content = [{type: 'text', text: body.join('\n')}];
      out.push(node);
      continue;
    }
    const heading = HEADING.exec(row);
    if (heading) {
      const content = inline(heading[2] ?? '');
      out.push({type: 'heading', attrs: {level: (heading[1] ?? '#').length}, ...(content.length > 0 ? {content} : {})});
      i++;
      continue;
    }
    if (RULE.test(row)) {
      out.push({type: 'rule'});
      i++;
      continue;
    }
    if (isItem(row)) {
      let end = i + 1;
      while (end < rows.length && !isBlank(rows[end] ?? '') && (isItem(rows[end] ?? '') || indentOf(rows[end] ?? '') > 0)) end++;
      out.push(...list(rows.slice(i, end)));
      i = end;
      continue;
    }
    let end = i + 1;
    while (end < rows.length && !isBlank(rows[end] ?? '') && !startsBlock(rows[end] ?? '')) end++;
    out.push(paragraph(rows.slice(i, end)));
    i = end;
  }
  return out;
}

/** Ticket markdown as a version 1 document that holds only the nodes of `WRITTEN_NODES`. Pure. */
export function markdownToAdf(markdown: string): AdfDoc {
  return {type: 'doc', version: 1, content: blocks(markdown.replace(/\r\n?/g, '\n').split('\n'))};
}
