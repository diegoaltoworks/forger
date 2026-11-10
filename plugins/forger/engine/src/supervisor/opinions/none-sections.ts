/**
 * Which sections of the ticket template the merged tickets answered "none".
 * Pure; the CLI reads the template and the issue bodies.
 */

export interface SectionNone {
  section: string;
  none: number;
  of: number;
}

/** The `## ` headings of a Markdown text, in order. */
export function sectionNames(markdown: string): string[] {
  return [...markdown.replace(/<!--[\s\S]*?-->/g, '').matchAll(/^## (.+?)\s*$/gm)].map(m => m[1]);
}

/** The answer under a heading, comments removed; null when the body has no such section. */
function answer(body: string, section: string): string | null {
  const parts = body.replace(/<!--[\s\S]*?-->/g, '').split(/^## /m).slice(1);
  const hit = parts.find(p => p.split('\n')[0].trim() === section);
  return hit === undefined ? null : hit.split('\n').slice(1).join('\n').trim();
}

export function computeNoneSections(sections: string[], bodies: string[]): SectionNone[] {
  return sections.map(section => ({
    section,
    none: bodies.filter(b => /^none\.?$/i.test(answer(b, section) ?? '')).length,
    of: bodies.length,
  }));
}

export function formatNoneSections(rows: SectionNone[]): string {
  return rows.length === 0 ? '' : ['sections answered none:', ...rows.map(r => `  ${r.section}: ${r.none} of ${r.of}`)].join('\n');
}
