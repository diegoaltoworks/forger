/** The changelog's entry for a version, and where it goes. Pure. */

import {changeLine, type Change} from './plan';

const HEADER = '# Changelog\n\n';

export function changelogEntry(version: string, changes: Change[]): string {
  const added = changes.filter(c => c.labels.includes('enhancement'));
  const fixed = changes.filter(c => !c.labels.includes('enhancement'));
  const group = (title: string, list: Change[]) => (list.length === 0 ? [] : [`### ${title}`, '', ...list.map(c => `- ${changeLine(c)}`), '']);
  return [`## ${version}`, '', ...group('Added', added), ...group('Fixed', fixed)].join('\n');
}

/** The entry goes above the first entry; a changelog with none gets it after its header, and a missing one is made. */
export function withEntry(existing: string | null, entry: string): string {
  const text = existing ?? HEADER;
  const at = text.search(/^## /m);
  if (at === -1) return `${text.replace(/\s*$/, '')}\n\n${entry}`;
  return `${text.slice(0, at)}${entry}\n${text.slice(at)}`;
}

export function firstEntryVersion(text: string | null): string | null {
  const m = text === null ? null : /^## (\S+)\s*$/m.exec(text);
  return m ? m[1] : null;
}

/** The body of the entry for a version, up to the next entry; null when the changelog has none for it. */
export function entryNotes(text: string | null, version: string): string | null {
  if (text === null) return null;
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trimEnd() === `## ${version}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}
