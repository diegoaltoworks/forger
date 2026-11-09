/**
 * Where a ticket's new code goes, as pure decisions over the ticket body and
 * what the structure pack records. A folder that is frozen, or already over its
 * limit in the baseline, takes no new file unless the ticket moves files out of
 * it or an open `structure` ticket that blocks it makes the room first.
 */

import {globToRegExp} from '../checks';
import {parseBlockedBy} from '../backlog';

const HEADING = /^#{1,6}\s+(.*?)\s*$/;

/** What `check ticket` knows about the tree's structure. */
export interface PlacementContext {
  /** The `frozen` globs of `.forger/structure.json`. */
  frozen: string[];
  /** The folders the structure baseline records over their limit. */
  overLimit: string[];
  /** Open issues labelled `structure`. */
  structureTickets: number[];
  /** The native blocked-by numbers of the ticket. */
  blockedBy: number[];
}

/** The text under the first heading starting with `name`, without HTML comments; null when absent. */
export function sectionText(body: string, name: string): string | null {
  let inSection = false;
  let present = false;
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      inSection = !present && new RegExp(`^${name}\\b`, 'i').test(heading[1]);
      if (inSection) present = true;
      continue;
    }
    if (inSection) lines.push(line);
  }
  return present ? lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim() : null;
}

const hasExtension = (segment: string): boolean => /\.[A-Za-z0-9]+$/.test(segment);

/** The folder a backticked path names: a path ending in `/` or with no file extension is itself the folder. */
export function folderOfPath(path: string): string {
  const clean = path.trim().replace(/^\.\//, '');
  if (clean.endsWith('/')) return clean.replace(/\/+$/, '') || '.';
  const slash = clean.lastIndexOf('/');
  if (!hasExtension(clean.slice(slash + 1))) return clean;
  return slash === -1 ? '.' : clean.slice(0, slash);
}

/** The folders a Placement section names; null when the section is absent, empty for "none". */
export function placementFolders(body: string): string[] | null {
  const text = sectionText(body, 'placement');
  if (text === null) return null;
  const folders: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const folder = folderOfPath(m[1]);
    if (folder !== '' && !folders.includes(folder)) folders.push(folder);
  }
  return folders;
}

export function placementWarnings(body: string): string[] {
  const text = sectionText(body, 'placement');
  if (text === null) return ['has no Placement section; name the folder each piece of new code goes in as backticked paths, or "none"'];
  return [];
}

const MOVE = /\b(?:move|moves|moved|moving|relocate|relocates|relocating|split|splits|splitting)\b/i;

function movesOutOf(body: string, folder: string): boolean {
  const build = sectionText(body, 'what to build');
  if (build === null) return false;
  return build.split(/\n\s*\n|\n(?=\s*[-*]\s)/).some(part => MOVE.test(part) && part.includes(folder));
}

/** One problem per Placement folder that is flagged and neither emptied by the ticket nor made room for by a blocking structure ticket. */
export function placementProblems(body: string, ctx: PlacementContext): string[] {
  const folders = placementFolders(body) ?? [];
  const blockers = [...ctx.blockedBy, ...parseBlockedBy(body)];
  const blockedByStructure = ctx.structureTickets.some(n => blockers.includes(n));
  const frozen = ctx.frozen.map(globToRegExp);
  const problems: string[] = [];
  for (const folder of folders) {
    const rule = frozen.some(re => re.test(folder))
      ? 'structure.frozen-folder (the folder is frozen)'
      : ctx.overLimit.includes(folder)
        ? 'structure.folder-size (the baseline records the folder over its limit)'
        : null;
    if (rule === null || blockedByStructure || movesOutOf(body, folder)) continue;
    problems.push(
      `Placement puts new code in ${folder}, which breaks ${rule}; either move files out of ${folder} in this ticket (name the move under "What to build"), or file a ticket labelled structure that makes a new folder and list it under "Blocked by"`
    );
  }
  return problems;
}
