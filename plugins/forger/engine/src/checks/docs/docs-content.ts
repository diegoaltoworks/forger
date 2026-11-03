/**
 * The docs pack's rules as pure functions: links and anchors resolve, images
 * exist, mermaid diagrams parse, and avoided glossary terms stay out of prose.
 * Reading files and listing the repo live in docs-check.ts; everything here
 * takes text (and, for links, two lookups) and returns findings.
 */

import type {Finding} from '../waivers';

export const DOCS_OPINIONS = {
  link: 'docs.links-resolve',
  anchor: 'docs.links-resolve',
  image: 'docs.images-resolve',
  diagram: 'docs.diagrams-parse',
  term: 'docs.glossary-terms',
} as const;

export type DocsRule = 'broken-link' | 'broken-anchor' | 'missing-image' | 'bad-diagram' | 'avoided-term';

interface Fence {
  /** Info string after the opening fence, e.g. `mermaid`. */
  info: string;
  /** 1-based line of the first line inside the fence. */
  start: number;
  body: string;
}

/** Fenced code blocks, and the text with their lines (fences included) blanked so line numbers survive. */
export function splitFences(text: string): {fences: Fence[]; prose: string[]} {
  const lines = text.split('\n');
  const fences: Fence[] = [];
  const prose: string[] = [];
  let open: {marker: string; info: string; start: number; body: string[]} | null = null;
  lines.forEach((line, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (open) {
      if (m && m[1][0] === open.marker[0] && m[1].length >= open.marker.length && m[2].trim() === '') {
        fences.push({info: open.info, start: open.start, body: open.body.join('\n')});
        open = null;
      } else open.body.push(line);
      prose.push('');
    } else if (m) {
      open = {marker: m[1], info: m[2].trim().split(/\s+/)[0] ?? '', start: i + 2, body: []};
      prose.push('');
    } else prose.push(line);
  });
  return {fences, prose};
}

/** Replaces inline code spans with spaces of equal length. */
export function blankCodeSpans(line: string): string {
  return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, m => ' '.repeat(m.length));
}

export interface LinkRef {
  line: number;
  target: string;
  image: boolean;
}

const LINK = /(!?)\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** Inline links and images outside code. */
export function extractLinks(text: string): LinkRef[] {
  const out: LinkRef[] = [];
  splitFences(text).prose.forEach((line, i) => {
    for (const m of blankCodeSpans(line).matchAll(LINK)) {
      const raw = m[2].startsWith('<') ? m[2].slice(1, -1) : m[2];
      out.push({line: i + 1, target: raw, image: m[1] === '!'});
    }
  });
  return out;
}

/** The anchors GitHub generates for the headings of a Markdown file. */
export function headingAnchors(text: string): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const line of splitFences(text).prose) {
    const m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

export interface LinkWorld {
  /** True when the repo-relative path is a file or directory. */
  exists(path: string): boolean;
  /** The text of a repo-relative Markdown file, or null when it cannot be read. */
  read(path: string): string | null;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '' : file.slice(0, i);
}

/** Resolves a link path against the file holding it; null when it climbs out of the repo. */
export function resolveRepoPath(file: string, target: string): string | null {
  const parts = (target.startsWith('/') ? [] : dirOf(file).split('/').filter(Boolean)) as string[];
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Relative links, `#anchors` and image paths of one Markdown file. */
export function checkLinks(file: string, text: string, world: LinkWorld): Finding[] {
  const out: Finding[] = [];
  const own = headingAnchors(text);
  for (const {line, target, image} of extractLinks(text)) {
    if (target === '' || EXTERNAL.test(target)) continue;
    const hash = target.indexOf('#');
    const rawPath = hash < 0 ? target : target.slice(0, hash);
    const anchor = hash < 0 ? null : decode(target.slice(hash + 1)).toLowerCase();
    const path = rawPath.split('?')[0];

    if (path === '') {
      if (anchor && anchor !== 'top' && !own.includes(anchor)) {
        out.push({file, line, rule: 'broken-anchor', opinion: DOCS_OPINIONS.anchor, detail: `#${anchor} matches no heading in this file`});
      }
      continue;
    }
    const resolved = resolveRepoPath(file, decode(path));
    if (resolved === null || !world.exists(resolved)) {
      out.push(
        image
          ? {file, line, rule: 'missing-image', opinion: DOCS_OPINIONS.image, detail: `${target} is not a file in the repo`}
          : {file, line, rule: 'broken-link', opinion: DOCS_OPINIONS.link, detail: `${target} does not resolve`}
      );
      continue;
    }
    if (anchor && !image && resolved.endsWith('.md')) {
      const body = world.read(resolved);
      if (body !== null && !headingAnchors(body).includes(anchor)) {
        out.push({file, line, rule: 'broken-anchor', opinion: DOCS_OPINIONS.anchor, detail: `#${anchor} matches no heading in ${resolved}`});
      }
    }
  }
  return out;
}

const DIAGRAM_TYPES = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'requirementDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'architecture-beta',
  'kanban',
];

const DIRECTIONS = ['TD', 'TB', 'BT', 'RL', 'LR'];
const OPENERS: Record<string, string> = {'[': ']', '(': ')', '{': '}'};
const CLOSERS = new Set(Object.values(OPENERS));

/** First problem in one flowchart line, or null. Quoted text is opaque. */
function flowchartLineProblem(line: string): string | null {
  const stack: string[] = [];
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch in OPENERS) stack.push(OPENERS[ch]);
    else if (CLOSERS.has(ch)) {
      if (stack.pop() !== ch) return `unbalanced "${ch}" in "${line.trim()}"`;
    }
  }
  if (quoted) return `unterminated quote in "${line.trim()}"`;
  if (stack.length > 0) return `unclosed bracket in "${line.trim()}"`;
  const bare = line.replace(/"[^"]*"/g, '""').replace(/\|[^|]*\|/g, '');
  if (/(?:-->|---|==>|-\.->|--[ox])\s*$/.test(bare) || /^\s*(?:-->|---|==>|-\.->)/.test(bare)) {
    return `an arrow has nothing on one side in "${line.trim()}"`;
  }
  return null;
}

/** The first thing wrong with a mermaid diagram, or null. A structural check: the type is known and flowcharts are well formed. */
export function mermaidProblem(code: string): string | null {
  let lines = code.split('\n');
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end < 0) return 'front matter is not closed';
    lines = lines.slice(end + 1);
  }
  const body = lines.map(l => l.trim()).filter(l => l !== '' && !l.startsWith('%%'));
  if (body.length === 0) return 'the diagram is empty';

  const head = body[0].split(/[\s;]+/);
  const type = head[0];
  if (!DIAGRAM_TYPES.includes(type)) return `unknown diagram type "${type}"`;
  if (body.length < 2 && type !== 'pie') return `a ${type} diagram has no content`;

  if (type === 'graph' || type === 'flowchart') {
    if (head[1] && !DIRECTIONS.includes(head[1])) return `unknown direction "${head[1]}"`;
    let depth = 0;
    for (const line of body.slice(1)) {
      if (/^subgraph\b/.test(line)) depth++;
      else if (line === 'end') {
        if (--depth < 0) return '"end" without a subgraph';
      }
      const p = flowchartLineProblem(line);
      if (p) return p;
    }
    if (depth > 0) return 'a subgraph is never closed with "end"';
  }
  return null;
}

/** Every mermaid block of a file that does not parse. */
export function checkDiagrams(file: string, text: string): Finding[] {
  return splitFences(text)
    .fences.filter(f => f.info === 'mermaid')
    .flatMap(f => {
      const problem = mermaidProblem(f.body);
      return problem ? [{file, line: f.start, rule: 'bad-diagram', opinion: DOCS_OPINIONS.diagram, detail: problem}] : [];
    });
}

export interface AvoidedTerm {
  /** The word or phrase to keep out of prose. */
  term: string;
  /** The glossary term that should be used instead. */
  use: string;
}

/**
 * The `_Avoid_:` lists of a glossary. A term with a parenthetical qualifier is
 * only wrong in one sense, which a pattern cannot tell, so it is not enforced.
 */
export function parseGlossaryAvoid(glossary: string): AvoidedTerm[] {
  const out: AvoidedTerm[] = [];
  let use = '';
  for (const line of glossary.split('\n')) {
    const bold = /^\*\*(.+?)\*\*:?\s*$/.exec(line);
    if (bold) use = bold[1];
    const m = /^_Avoid_:\s*(.*)$/.exec(line);
    if (!m || use === '') continue;
    for (const raw of m[1].split(/,(?![^(]*\))/)) {
      const term = raw.trim();
      if (term === '' || term.includes('(')) continue;
      out.push({term, use});
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Avoided terms as whole words in prose; code fences, code spans and path-like tokens (`runner.lock`) are not prose. */
export function checkAvoidedTerms(file: string, text: string, terms: AvoidedTerm[]): Finding[] {
  if (terms.length === 0) return [];
  const re = terms.map(t => ({t, re: new RegExp(`(?<![\\w/.-])${escapeRe(t.term)}(?![\\w-]|\\.\\w)`, 'i')}));
  const out: Finding[] = [];
  splitFences(text).prose.forEach((line, i) => {
    const visible = blankCodeSpans(line);
    for (const {t, re: r} of re) {
      if (r.test(visible)) {
        out.push({file, line: i + 1, rule: 'avoided-term', opinion: DOCS_OPINIONS.term, detail: `"${t.term}" is avoided; say "${t.use}"`});
      }
    }
  });
  return out;
}
