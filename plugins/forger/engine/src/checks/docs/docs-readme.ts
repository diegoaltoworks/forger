/**
 * The README rule of the docs pack as pure functions over Markdown text: the
 * measurable writing rules of Simplified Technical English (ADR 0017). Code
 * blocks, tables, quotes, headings and images are not prose and are skipped.
 */

import {splitFences} from './docs-content';
import type {Finding} from '../waivers';

export const README_OPINIONS = {
  purpose: 'docs.readme-purpose-first',
  sentences: 'docs.readme-short-sentences',
  voice: 'docs.readme-active-voice',
  transient: 'docs.readme-no-transient',
} as const;

export type ReadmeRule =
  | 'readme-purpose'
  | 'readme-sentence-length'
  | 'readme-paragraph-length'
  | 'readme-passive-voice'
  | 'readme-transient';

export interface ReadmeFinding extends Finding {
  rule: ReadmeRule;
  /** A warning is reported and never fails the check. */
  severity: 'fail' | 'warn';
}

export const LIMITS = {procedural: 20, descriptive: 25, paragraph: 6, purpose: 2} as const;

/** Whether a path is a README the rule holds to the standard. */
export function isCheckedReadme(file: string): boolean {
  const parts = file.split('/');
  return parts[parts.length - 1] === 'README.md' && !parts.includes('node_modules') && !parts.includes('fixtures');
}

interface Block {
  line: number;
  text: string;
  item: boolean;
}

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** Prose blocks (paragraphs and list items), with code spans collapsed to one word and links to their text. */
export function proseBlocks(text: string): Block[] {
  const lines = splitFences(text).prose;
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const skip = /^\s*(#|\||>|<|!\[|\[[^\]]+\]:\s)/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line);
    if (line.trim() === '' || skip) return flush();
    const body = line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, 'code').replace(/\s{2,}/g, ' ').trim();
    if (ITEM.test(line)) {
      flush();
      cur = {line: i + 1, text: body.replace(ITEM, ''), item: true};
    } else if (cur) cur.text += ' ' + body;
    else cur = {line: i + 1, text: body, item: false};
  });
  flush();
  return blocks.map(b => ({...b, text: b.text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')}));
}

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs)\./gi;

export function splitSentences(text: string): string[] {
  return text
    .replace(ABBREVIATIONS, m => m.replace('.', ''))
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map(s => s.trim())
    .filter(s => s !== '');
}

export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length;
}

const TRANSIENT: Array<[RegExp, string]> = [
  [/\b\d[\d,]*\+?\s+(?:files?|tests?|lines?|modules?|entit(?:y|ies))\b/gi, 'a count of things'],
  [/\bas of\b/gi, 'an "as of" snapshot'],
  [/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (?:\d{1,2}, )?\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g, 'a date'],
  [/\b(?:currently|recently|new)\b|\bat the moment\b/gi, 'a time-bound word'],
  [/\bv?\d+\.\d+(?:\.\d+)?\b/g, 'a version number'],
];

const PASSIVE =
  /\b(?:is|are|was|were|been|being|be)\s+(?:\w+ly\s+)?(?:\w{3,}ed|written|made|run|shown|given|known|built|kept|done|taken|seen|chosen|found|held|sent|set|read|used|stored)\b/gi;

function at(file: string, line: number, rule: ReadmeRule, opinion: string, detail: string, severity: 'fail' | 'warn'): ReadmeFinding {
  return {file, line, rule, opinion, detail, severity};
}

const quote = (s: string) => (s.length > 60 ? s.slice(0, 57) + '...' : s);

/** Every finding for one README, in line order. */
export function checkReadme(file: string, text: string): ReadmeFinding[] {
  const out: ReadmeFinding[] = [];
  const prose = splitFences(text).prose;
  const h1 = prose.findIndex(l => /^#\s+\S/.test(l));
  const blocks = proseBlocks(text);

  if (h1 < 0) out.push(at(file, 1, 'readme-purpose', README_OPINIONS.purpose, 'no H1 heading to state the purpose under', 'fail'));
  else {
    const next = prose.slice(h1 + 1).findIndex(l => l.trim() !== '' && !/^\s*(!\[|<)/.test(l));
    const first = next < 0 ? undefined : blocks.find(b => b.line === h1 + 2 + next);
    if (!first || first.item) {
      out.push(at(file, h1 + 1, 'readme-purpose', README_OPINIONS.purpose, 'the first paragraph after the H1 must state what this is and who it is for', 'fail'));
    } else if (splitSentences(first.text).length > LIMITS.purpose) {
      out.push(at(file, first.line, 'readme-purpose', README_OPINIONS.purpose, `the purpose paragraph must be at most ${LIMITS.purpose} sentences`, 'fail'));
    }
  }

  for (const b of blocks) {
    const sentences = splitSentences(b.text);
    const limit = b.item ? LIMITS.procedural : LIMITS.descriptive;
    for (const s of sentences) {
      const n = wordCount(s);
      if (n > limit) out.push(at(file, b.line, 'readme-sentence-length', README_OPINIONS.sentences, `${n} words (limit ${limit}): "${quote(s)}"`, 'fail'));
    }
    if (!b.item && sentences.length > LIMITS.paragraph) {
      out.push(at(file, b.line, 'readme-paragraph-length', README_OPINIONS.sentences, `${sentences.length} sentences (limit ${LIMITS.paragraph})`, 'fail'));
    }
    for (const m of b.text.matchAll(PASSIVE)) out.push(at(file, b.line, 'readme-passive-voice', README_OPINIONS.voice, `passive voice: "${m[0]}"`, 'warn'));
    for (const [re, what] of TRANSIENT) {
      for (const m of b.text.matchAll(re)) out.push(at(file, b.line, 'readme-transient', README_OPINIONS.transient, `${what}: "${m[0]}"`, 'fail'));
    }
  }
  return out.sort((a, b) => a.line - b.line);
}
