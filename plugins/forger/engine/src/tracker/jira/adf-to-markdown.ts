import type {AdfMark, AdfNode} from './adf';

function hasMark(node: AdfNode, type: string): AdfMark | undefined {
  return node.marks?.find((m) => m.type === type);
}

/** A code span long enough that the text's own backticks cannot close it. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '');
  return pad ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

function withMarks(node: AdfNode, text: string): string {
  let out = hasMark(node, 'code') ? codeSpan(text) : text;
  if (hasMark(node, 'em')) out = `*${out}*`;
  if (hasMark(node, 'strong')) out = `**${out}**`;
  const link = hasMark(node, 'link');
  if (link) out = `[${out}](${String(link.attrs?.href ?? '')})`;
  return out;
}

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(inlineNode).join('');
}

function inlineNode(node: AdfNode): string {
  if (node.type === 'text') return withMarks(node, node.text ?? '');
  if (node.type === 'hardBreak') return '\n';
  const own = node.text ?? (typeof node.attrs?.text === 'string' ? node.attrs.text : undefined) ?? (typeof node.attrs?.shortName === 'string' ? node.attrs.shortName : undefined);
  if (own !== undefined) return own;
  return node.content?.some((child) => child.content !== undefined) ? blocks(node.content) : inline(node.content);
}

function indentAfterFirst(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 || line === '' ? line : pad + line))
    .join('\n');
}

function listItem(item: AdfNode, marker: string): string {
  const body = (item.content ?? []).map(block).filter((s) => s !== '').join('\n');
  return marker + indentAfterFirst(body, ' '.repeat(marker.length));
}

function taskList(list: AdfNode): string {
  return (list.content ?? [])
    .map((node) => {
      if (node.type === 'taskList') return taskList(node).replace(/^/gm, '  ');
      const done = node.attrs?.state === 'DONE';
      return `- [${done ? 'x' : ' '}] ${inline(node.content)}`;
    })
    .join('\n');
}

function codeBlock(node: AdfNode): string {
  const text = (node.content ?? []).map((n) => n.text ?? '').join('');
  const longest = Math.max(0, ...(text.match(/`{3,}/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
  return `${fence}${language}\n${text}\n${fence}`;
}

function block(node: AdfNode): string {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content);
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `${'#'.repeat(level)} ${inline(node.content)}`;
    }
    case 'bulletList':
      return (node.content ?? []).map((item) => listItem(item, '- ')).join('\n');
    case 'orderedList': {
      const start = Number(node.attrs?.order ?? 1);
      return (node.content ?? []).map((item, i) => listItem(item, `${start + i}. `)).join('\n');
    }
    case 'taskList':
      return taskList(node);
    case 'codeBlock':
      return codeBlock(node);
    case 'rule':
      return '---';
    default:
      return inlineNode(node);
  }
}

function blocks(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(block).filter((s) => s !== '').join('\n\n');
}

/** A document's text as the ticket markdown the engine reads. Text is written as it is, never escaped. Pure. */
export function adfToMarkdown(doc: AdfNode): string {
  return blocks(doc.type === 'doc' ? doc.content : [doc]);
}
