/**
 * Reads the product brief (`docs/product.md`): who the app is for, the journeys
 * they must be able to do, how success shows and what is out. Pure: the caller
 * reads the file and hands the text in.
 */

export const PRODUCT_BRIEF_PATH = 'docs/product.md';

export interface ProductBrief {
  who: string;
  /** One named journey per list item under "What they must be able to do". */
  journeys: string[];
  success: string;
  out: string;
  /** Each missing or empty section, naming it. */
  problems: string[];
}

const HEADINGS = {
  who: 'Who it is for',
  journeys: 'What they must be able to do',
  success: 'How success shows',
  out: 'Out',
} as const;

type Section = keyof typeof HEADINGS;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

// A line that is only a <placeholder> is the template's prompt, not an answer.
const isPlaceholder = (line: string) => /^<[^<>]*>$/.test(line.trim());

function sectionsOf(text: string): Map<Section, string[]> {
  const byHeading = new Map<string, Section>(Object.entries(HEADINGS).map(([k, v]) => [v.toLowerCase(), k as Section]));
  const found = new Map<Section, string[]>();
  let current: string[] | undefined;
  let fenced = false;
  for (const line of text.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const section = byHeading.get(heading[1].trim().toLowerCase());
      current = section && !found.has(section) ? [] : undefined;
      if (section && current) found.set(section, current);
      continue;
    }
    if (!fenced && /^#{1,2}\s/.test(line)) current = undefined;
    current?.push(line);
  }
  return found;
}

const proseOf = (lines: string[]) =>
  lines
    .filter(l => !isPlaceholder(l))
    .join('\n')
    .trim();

function journeysOf(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (item[1].trim() !== '' && !isPlaceholder(item[1])) items.push(item[1].trim());
    } else if (/^\s+\S/.test(line) && items.length > 0 && !isPlaceholder(line)) {
      items[items.length - 1] += ` ${line.trim()}`;
    }
  }
  return items;
}

export function parseProductBrief(text: string): ProductBrief {
  const sections = sectionsOf(text);
  const problems: string[] = [];
  const read = <T>(section: Section, parse: (lines: string[]) => T, empty: (v: T) => boolean): T => {
    const lines = sections.get(section);
    const value = parse(lines ?? []);
    if (!lines) problems.push(`missing section "## ${HEADINGS[section]}"`);
    else if (empty(value)) problems.push(`empty section "## ${HEADINGS[section]}"`);
    return value;
  };
  const who = read('who', proseOf, v => v === '');
  const journeys = read('journeys', journeysOf, v => v.length === 0);
  const success = read('success', proseOf, v => v === '');
  const out = read('out', proseOf, v => v === '');
  return {who, journeys, success, out, problems};
}
